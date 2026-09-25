import crypto from "node:crypto";
import fs from "node:fs/promises";
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

const QUICKBOOKS_SCOPE = "com.intuit.quickbooks.accounting";
const QUICKBOOKS_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QUICKBOOKS_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QUICKBOOKS_CONNECTION_FILE = "/var/lib/zetrick/quickbooks.json";

// OAuth state is intentionally short-lived and single-use.
// This is acceptable for a single-process server. If you run
// multiple processes/instances, move this to MongoDB or Redis.
const oauth_states = new Map<string, number>();

interface quickbooks_callback_query {
    code?: string;
    state?: string;
    realmId?: string;

    error?: string;
    error_description?: string;
}

interface quickbooks_token_response {
    access_token: string;
    refresh_token: string;

    expires_in: number;
    x_refresh_token_expires_in: number;

    token_type: string;
}

interface quickbooks_connection {
    realm_id: string;

    access_token: string;
    refresh_token: string;

    access_token_expires_at: Date;
    refresh_token_expires_at: Date;
    connected_at: Date;
}

function format_UTC(input: Date) {
    const date = input instanceof Date ? input : new Date(input);
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = date.getUTCFullYear();

    let hours = date.getUTCHours();
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12 || 12;
    const hh = String(hours).padStart(2, "0");

    return `${dd}/${mm}/${yyyy} at ${hh}:${minutes} ${ampm} UTC`;
}

async function load_quickbooks_connection(): Promise<quickbooks_connection | null> {
    try {
        const contents = await fs.readFile(QUICKBOOKS_CONNECTION_FILE, {
            encoding: "utf8",
        });

        return JSON.parse(contents) as quickbooks_connection;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }

        throw error;
    }
}

async function handle_quickbooks_launch(_request: FastifyRequest, reply: FastifyReply) {
    const connected = await load_quickbooks_connection();

    const connection_status = connected
        ? `
            <p>
                <span style="color: #16803c; font-weight: 600;">
        ● Connected to QuickBooks at ${format_UTC(connected.connected_at)} (expires ${format_UTC(connected.access_token_expires_at)})
                </span>
            </p>
          `
        : `
            <p>
                <a class="button"
                   href="/quickbooks/connect">
                    Connect QuickBooks
                </a>
            </p>
          `;

    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "Zetrick QuickBooks Integration",
            `
                <h1>Zetrick QuickBooks Integration</h1>

                <p>
                    This application integrates Zetrick LLC's
                    internal business systems with QuickBooks
                    Online.
                </p>

                ${connection_status}

                <p>
                    <a href="/quickbooks/privacy">
                        Privacy Policy
                    </a>
                    &nbsp;&middot;&nbsp;
                    <a href="/quickbooks/terms">
                        Terms of Use
                    </a>
                </p>
            `
        )
    );
}

async function handle_quickbooks_connect(_request: FastifyRequest, reply: FastifyReply) {
    // Generate a cryptographically random CSRF token.
    const state = crypto.randomBytes(32).toString("base64url");

    // State is valid for ten minutes.
    oauth_states.set(state, Date.now() + 10 * 60 * 1000);
    cleanup_oauth_states();
    const params = new URLSearchParams({
        client_id: config.quickbooks.client_id,
        response_type: "code",
        scope: QUICKBOOKS_SCOPE,
        redirect_uri: config.quickbooks.redirect_uri,
        state,
    });

    return reply.redirect(`${QUICKBOOKS_AUTH_URL}?${params.toString()}`);
}

async function handle_quickbooks_callback(
    request: FastifyRequest<{
        Querystring: quickbooks_callback_query;
    }>,
    reply: FastifyReply
) {
    const { code, state, realmId, error, error_description } = request.query;

    // The user may have denied authorization, or Intuit
    // may have returned another OAuth error.
    if (error) {
        request.log.warn(
            {
                error,
                error_description,
            },
            "QuickBooks OAuth authorization failed"
        );

        return reply
            .code(400)
            .type("text/html; charset=utf-8")
            .send(
                error_page(
                    "QuickBooks Authorization Failed",
                    error_description ?? "QuickBooks authorization was not completed."
                )
            );
    }

    // All three are required for a successful callback.
    if (!code || !state || !realmId) {
        request.log.warn("Incomplete QuickBooks OAuth callback");

        return reply
            .code(400)
            .type("text/html; charset=utf-8")
            .send(
                error_page(
                    "Invalid Authorization Response",
                    "The authorization response from QuickBooks was incomplete."
                )
            );
    }

    // Validate CSRF state.
    // consume_oauth_state() deletes it whether valid or
    // expired so that state values cannot be replayed.
    if (!consume_oauth_state(state)) {
        request.log.warn("Rejected QuickBooks OAuth callback due to invalid state");

        return reply
            .code(400)
            .type("text/html; charset=utf-8")
            .send(
                error_page(
                    "Authorization Validation Failed",
                    "The authorization request could not be verified. Please reconnect QuickBooks."
                )
            );
    }

    // Exchange the short-lived authorization code for
    // access + refresh tokens.
    const basic_auth = Buffer.from(`${config.quickbooks.client_id}:${config.quickbooks.client_secret}`).toString(
        "base64"
    );
    let token_response: Response;
    try {
        token_response = await fetch(QUICKBOOKS_TOKEN_URL, {
            method: "POST",
            headers: {
                Authorization: `Basic ${basic_auth}`,
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: config.quickbooks.redirect_uri,
            }),
        });
    } catch (err) {
        request.log.error({ err }, "Unable to contact QuickBooks OAuth server");
        return reply
            .code(502)
            .type("text/html; charset=utf-8")
            .send(
                error_page("QuickBooks Connection Failed", "Unable to communicate with QuickBooks. Please try again.")
            );
    }

    if (!token_response.ok) {
        // Don't log the authorization code or credentials.
        const response_body = await token_response.text();

        request.log.error(
            {
                status: token_response.status,
                response_body,
            },
            "QuickBooks token exchange failed"
        );

        return reply
            .code(502)
            .type("text/html; charset=utf-8")
            .send(
                error_page(
                    "QuickBooks Connection Failed",
                    "QuickBooks could not complete the authorization. Please try connecting again."
                )
            );
    }

    const tokens = (await token_response.json()) as quickbooks_token_response;

    // Persist this.
    await save_quickbooks_connection({
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000),
        refresh_token_expires_at: new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000),
        connected_at: new Date(),
    });

    request.log.info(
        {
            realm_id: realmId,
        },
        "QuickBooks connected successfully"
    );

    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "QuickBooks Connected",
            `
                    <h1>QuickBooks Connected</h1>

                    <p>
                        Zetrick's QuickBooks Online
                        integration was successfully
                        authorized.
                    </p>

                    <p>
                        You may close this window.
                    </p>
                `
        )
    );
}

// Note that this is the page the browser is sent to
// when disconnecting. It is not itself a webhook.
async function handle_quickbooks_disconnected(_request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "QuickBooks Disconnected",
            `
                    <h1>QuickBooks Disconnected</h1>

                    <p>
                        The Zetrick QuickBooks Online
                        integration has been disconnected.
                    </p>

                    <p>
                        <a class="button"
                           href="/quickbooks/connect">
                            Reconnect QuickBooks
                        </a>
                    </p>
                `
        )
    );
}

async function handle_quickbooks_terms(_request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "Terms of Use",
            `
                    <h1>Terms of Use</h1>

                    <p>
                        <strong>Effective Date:</strong>
                        September 24, 2026
                    </p>

                    <p>
                        These Terms of Use apply to the
                        Zetrick QuickBooks Integration
                        ("Application"), an internal software
                        application operated by Zetrick LLC
                        ("Zetrick").
                    </p>

                    <h2>Purpose</h2>

                    <p>
                        The Application integrates Zetrick's
                        internal business systems with
                        QuickBooks Online for accounting and
                        related business operations.
                    </p>

                    <h2>Authorized Use</h2>

                    <p>
                        Access to the Application is limited
                        to individuals authorized by Zetrick.
                    </p>

                    <h2>QuickBooks Integration</h2>

                    <p>
                        The Application may access QuickBooks
                        Online data after authorization
                        through Intuit's authentication
                        services.
                    </p>

                    <h2>Data</h2>

                    <p>
                        The Application may process business,
                        accounting, vendor, contractor,
                        transaction, and related information
                        necessary to provide its functionality.
                    </p>

                    <h2>Third-Party Services</h2>

                    <p>
                        The Application relies on third-party
                        services, including QuickBooks Online.
                    </p>

                    <h2>Contact</h2>

                    <p>
                        Questions regarding these Terms of Use
                        may be directed to Zetrick LLC.
                    </p>
                `
        )
    );
}

async function handle_quickbooks_privacy(_request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "Privacy Policy",
            `
                    <h1>Privacy Policy</h1>

                    <p>
                        <strong>Effective Date:</strong>
                        September 24, 2026
                    </p>

                    <p>
                        This Privacy Policy describes how
                        Zetrick LLC ("Zetrick") handles
                        information through the Zetrick
                        QuickBooks Integration
                        ("Application").
                    </p>

                    <h2>Information We Access</h2>

                    <p>
                        The Application may access information
                        authorized through the QuickBooks
                        connection, including:
                    </p>

                    <ul>
                        <li>
                            Vendor and contractor information
                        </li>

                        <li>
                            Accounting and financial
                            transaction information
                        </li>

                        <li>
                            Expense and payment records
                        </li>

                        <li>
                            Account and category information
                        </li>
                    </ul>

                    <p>
                        The Application may create or update
                        information in QuickBooks Online as
                        part of Zetrick's business and
                        accounting processes.
                    </p>

                    <h2>How Information Is Used</h2>

                    <p>
                        Information is used for Zetrick's
                        internal business purposes, including
                        synchronizing business records,
                        managing vendors and contractors,
                        recording expenses and payments, and
                        supporting accounting operations.
                    </p>

                    <h2>Information Sharing</h2>

                    <p>
                        Information obtained through the
                        QuickBooks integration is not sold or
                        rented.
                    </p>

                    <h2>Data Security</h2>

                    <p>
                        Zetrick uses reasonable
                        administrative, technical, and
                        organizational safeguards designed
                        to protect information processed by
                        the Application.
                    </p>

                    <h2>QuickBooks Authorization</h2>

                    <p>
                        Access to QuickBooks Online is
                        authorized through Intuit's
                        authentication and authorization
                        services. The Application does not
                        require users to provide their
                        QuickBooks password to Zetrick.
                    </p>

                    <h2>Data Retention</h2>

                    <p>
                        Information is retained only as
                        reasonably necessary for Zetrick's
                        business, accounting, legal,
                        compliance, and operational purposes.
                    </p>

                    <h2>Third-Party Services</h2>

                    <p>
                        The Application integrates with
                        QuickBooks Online, a service provided
                        by Intuit. Information processed by
                        Intuit is subject to Intuit's
                        applicable policies and terms.
                    </p>

                    <h2>Contact</h2>

                    <p>
                        Questions regarding this Privacy
                        Policy may be directed to Zetrick LLC.
                    </p>
                `
        )
    );
}

// Consume an OAuth state exactly once.
function consume_oauth_state(state: string): boolean {
    const expires_at = oauth_states.get(state);

    // Delete before doing anything else.
    // State is single-use.
    oauth_states.delete(state);
    if (!expires_at) return false;
    if (expires_at < Date.now()) return false;
    return true;
}

function cleanup_oauth_states(): void {
    const now = Date.now();

    for (const [state, expires_at] of oauth_states.entries()) {
        if (expires_at < now) oauth_states.delete(state);
    }
}

async function save_quickbooks_connection(connection: quickbooks_connection): Promise<void> {
    // We do this because a write to tmp file and rename is atomic
    const temporary_file = `${QUICKBOOKS_CONNECTION_FILE}.tmp`;
    await fs.writeFile(temporary_file, JSON.stringify(connection, null, 4), {
        encoding: "utf8",
        mode: 0o600,
    });
    await fs.rename(temporary_file, QUICKBOOKS_CONNECTION_FILE);
}

function error_page(title: string, message: string): string {
    return html_page(
        title,
        `
            <h1>${escape_html(title)}</h1>

            <p>
                ${escape_html(message)}
            </p>

            <p>
                <a class="button"
                   href="/quickbooks/connect">
                    Connect QuickBooks
                </a>
            </p>
        `
    );
}

function escape_html(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function html_page(title: string, content: string): string {
    return `
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
    >

    <title>${escape_html(title)}</title>

    <style>
        body {
            margin: 0;
            background: #fff;
            color: #222;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Helvetica,
                Arial,
                sans-serif;

            line-height: 1.6;
        }

        main {
            max-width: 800px;
            margin: 0 auto;
            padding: 48px 24px 80px;
        }

        h1 {
            margin-bottom: 28px;
        }

        h2 {
            margin-top: 36px;
        }

        .button {
            display: inline-block;
            padding: 10px 16px;

            background: #222;
            color: #fff;

            text-decoration: none;
            border-radius: 4px;
        }
    </style>
</head>

<body>
    <main>
        ${content}
    </main>
</body>
</html>
    `;
}

export async function create_quickbooks_routes(): Promise<FastifyPluginAsync> {
    // Create the persisted OAuth cred file
    await fs.mkdir("/var/lib/zetrick", {
        recursive: true,
        mode: 0o700,
    });

    return async (fastify: FastifyInstance) => {
        fastify.get("/quickbooks", handle_quickbooks_launch);
        fastify.get("/quickbooks/terms", handle_quickbooks_terms);
        fastify.get("/quickbooks/privacy", handle_quickbooks_privacy);
        fastify.get("/quickbooks/connect", handle_quickbooks_connect);
        fastify.get<{
            Querystring: quickbooks_callback_query;
        }>("/quickbooks/callback", handle_quickbooks_callback);
        fastify.get("/quickbooks/disconnected", handle_quickbooks_disconnected);
    };
}
