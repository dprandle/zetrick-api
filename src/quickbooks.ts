import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

// All QuickBooks Online OAuth logic, secrets and tokens live in qbosync, which is
// the only process that talks to QBO (and the only one allowed to refresh the
// rotating refresh token). Intuit needs a public redirect URL, so these routes stay
// here and forward to qbosync's loopback server, like the qbtsync invite endpoint.
const QBOSYNC_URL = "http://localhost:3002";

interface quickbooks_callback_query {
    code?: string;
    state?: string;
    realmId?: string;

    error?: string;
    error_description?: string;
}

interface qbosync_status {
    connected: boolean;
    qbo_env: string;
    realm_id?: string;
    connected_at?: string;
    access_token_expires_at?: string;
    refresh_token_expires_at?: string;
}

interface qbosync_callback_result {
    ok: boolean;
    status: number;
    title: string;
    message: string;
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

    return `${mm}/${dd}/${yyyy} at ${hh}:${minutes} ${ampm} UTC`;
}

async function fetch_qbosync_status(): Promise<qbosync_status | null> {
    try {
        const resp = await fetch(`${QBOSYNC_URL}/oauth/status`);
        if (!resp.ok) return null;
        return (await resp.json()) as qbosync_status;
    } catch {
        return null;
    }
}

async function handle_quickbooks_launch(request: FastifyRequest, reply: FastifyReply) {
    const status = await fetch_qbosync_status();
    if (!status) request.log.error("qbosync status endpoint unreachable");

    // Connected means the refresh token is still valid; the access token itself
    // is refreshed by qbosync on demand, so its expiry isn't interesting here.
    const connect_button = `
            <p>
                <a class="button"
                   href="/quickbooks/connect">
                    ${status?.realm_id ? "Reconnect" : "Connect"} QuickBooks
                </a>
            </p>
          `;
    const connection_status = !status
        ? `
            <p>
                <span style="color: #b42318; font-weight: 600;">
        ● QuickBooks sync service is not reachable
                </span>
            </p>
          `
        : status.connected
          ? `
            <p>
                <span style="color: #16803c; font-weight: 600;">
        ● Connected to QuickBooks (${escape_html(status.qbo_env)}) on ${format_UTC(new Date(status.connected_at!))} (reconnect needed by ${format_UTC(new Date(status.refresh_token_expires_at!))})
                </span>
            </p>
          `
          : connect_button;

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

async function handle_quickbooks_connect(request: FastifyRequest, reply: FastifyReply) {
    try {
        const resp = await fetch(`${QBOSYNC_URL}/oauth/connect_url`);
        if (!resp.ok) throw new Error(`qbosync returned ${resp.status}`);
        const { url } = (await resp.json()) as { url: string };
        return reply.redirect(url);
    } catch (err) {
        request.log.error({ err }, "Unable to get QuickBooks connect URL from qbosync");
        return reply
            .code(502)
            .type("text/html; charset=utf-8")
            .send(error_page("QuickBooks Connection Failed", "The QuickBooks sync service is not reachable."));
    }
}

async function handle_quickbooks_callback(
    request: FastifyRequest<{
        Querystring: quickbooks_callback_query;
    }>,
    reply: FastifyReply
) {
    // Forward only the fields qbosync expects; it validates state and realm,
    // exchanges the code and stores the tokens.
    const { code, state, realmId, error, error_description } = request.query;
    let result: qbosync_callback_result;
    try {
        const resp = await fetch(`${QBOSYNC_URL}/oauth/callback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, state, realmId, error, error_description }),
        });
        result = (await resp.json()) as qbosync_callback_result;
    } catch (err) {
        request.log.error({ err }, "Unable to forward QuickBooks OAuth callback to qbosync");
        result = {
            ok: false,
            status: 502,
            title: "QuickBooks Connection Failed",
            message: "The QuickBooks sync service is not reachable. Please try again.",
        };
    }

    if (!result.ok) {
        request.log.warn({ title: result.title }, "QuickBooks OAuth callback failed");
        return reply
            .code(result.status)
            .type("text/html; charset=utf-8")
            .send(error_page(result.title, result.message));
    }

    request.log.info({ realm_id: realmId }, "QuickBooks connected successfully");
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            result.title,
            `
                    <h1>${escape_html(result.title)}</h1>

                    <p>
                        ${escape_html(result.message)}
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
