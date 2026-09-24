import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

async function handle_quickbooks_launch(_request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "Zetrick QuickBooks Integration",
            `
                    <h1>Zetrick QuickBooks Integration</h1>

                    <p>
                        This application is an internal business
                        application operated by Zetrick LLC.
                    </p>

                    <p>
                        The application integrates Zetrick's internal
                        business systems with QuickBooks Online for
                        accounting and related business operations.
                    </p>

                    <p>
                        <a href="/quickbooks/privacy">
                            Privacy Policy
                        </a>
                    </p>

                    <p>
                        <a href="/quickbooks/terms">
                            Terms of Use
                        </a>
                    </p>
                `
        )
    );
}

async function handle_quickbooks_connect(request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "Connect QuickBooks",
            `
                    <h1>Connect QuickBooks</h1>

                    <p>
                        This page is used to initiate the connection
                        between Zetrick's internal business systems
                        and QuickBooks Online.
                    </p>
                `
        )
    );
}

async function handle_quickbooks_callback(request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "QuickBooks Connection",
            `
                    <h1>QuickBooks Connection</h1>

                    <p>
                        This page handles authorization responses
                        from QuickBooks Online.
                    </p>
                `
        )
    );
}

async function handle_quickbooks_disconnected(request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "QuickBooks Disconnected",
            `
                    <h1>QuickBooks Disconnected</h1>

                    <p>
                        The Zetrick QuickBooks Online integration
                        has been disconnected.
                    </p>
                `
        )
    );
}

async function handle_quickbooks_terms(request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "Zetrick QuickBooks Integration - Terms of Use",
            `
                    <h1>Terms of Use</h1>

                    <p>
                        <strong>Effective Date:</strong>
                        September 24, 2026
                    </p>

                    <p>
                        These Terms of Use apply to the Zetrick
                        QuickBooks Integration ("Application"), an
                        internal software application operated by
                        Zetrick LLC ("Zetrick").
                    </p>

                    <h2>Purpose</h2>

                    <p>
                        The Application is intended for authorized
                        internal use by Zetrick and its authorized
                        personnel. The Application integrates
                        Zetrick's internal business systems with
                        QuickBooks Online for accounting and related
                        business operations.
                    </p>

                    <h2>Authorized Use</h2>

                    <p>
                        Access to the Application is limited to
                        individuals authorized by Zetrick. Users may
                        not access or use the Application for any
                        unauthorized, unlawful, or fraudulent
                        purpose.
                    </p>

                    <h2>QuickBooks Integration</h2>

                    <p>
                        The Application may access QuickBooks Online
                        data after appropriate authorization through
                        Intuit's authentication services. Access to
                        QuickBooks Online is subject to Intuit's
                        applicable terms and policies.
                    </p>

                    <h2>Data</h2>

                    <p>
                        The Application may process business,
                        accounting, vendor, contractor, transaction,
                        and related information necessary to provide
                        its functionality. Information is handled in
                        accordance with Zetrick's Privacy Policy.
                    </p>

                    <h2>Availability</h2>

                    <p>
                        The Application is provided for Zetrick's
                        internal business purposes. Zetrick does not
                        guarantee uninterrupted or error-free
                        operation of the Application.
                    </p>

                    <h2>Third-Party Services</h2>

                    <p>
                        The Application relies on third-party
                        services, including QuickBooks Online.
                        Zetrick is not responsible for the
                        availability, operation, or policies of
                        third-party services.
                    </p>

                    <h2>Changes</h2>

                    <p>
                        Zetrick may modify these Terms of Use or the
                        Application at any time.
                    </p>

                    <h2>Contact</h2>

                    <p>
                        Questions regarding these Terms of Use may
                        be directed to Zetrick LLC.
                    </p>
                `
        )
    );
}

async function handle_quickbooks_privacy(request: FastifyRequest, reply: FastifyReply) {
    return reply.type("text/html; charset=utf-8").send(
        html_page(
            "Zetrick QuickBooks Integration - Privacy Policy",
            `
                    <h1>Privacy Policy</h1>

                    <p>
                        <strong>Effective Date:</strong>
                        September 24, 2026
                    </p>

                    <p>
                        This Privacy Policy describes how Zetrick LLC
                        ("Zetrick") handles information through the
                        Zetrick QuickBooks Integration
                        ("Application"). The Application is an
                        internal business application used by
                        Zetrick to integrate its business systems
                        with QuickBooks Online.
                    </p>

                    <h2>Information We Access</h2>

                    <p>
                        When the Application is connected to
                        QuickBooks Online, it may access information
                        authorized through the QuickBooks connection,
                        including:
                    </p>

                    <ul>
                        <li>
                            Vendor and contractor information;
                        </li>
                        <li>
                            Accounting and financial transaction
                            information;
                        </li>
                        <li>
                            Expense and payment records;
                        </li>
                        <li>
                            Account and category information; and
                        </li>
                        <li>
                            Other QuickBooks Online information
                            necessary to provide the Application's
                            functionality.
                        </li>
                    </ul>

                    <p>
                        The Application may also create or update
                        information in QuickBooks Online as part of
                        Zetrick's business and accounting processes.
                    </p>

                    <h2>How Information Is Used</h2>

                    <p>
                        Information accessed through the Application
                        is used solely for Zetrick's legitimate
                        internal business purposes, including:
                    </p>

                    <ul>
                        <li>
                            Synchronizing business records with
                            QuickBooks Online;
                        </li>
                        <li>
                            Managing vendor and contractor records;
                        </li>
                        <li>
                            Recording expenses and payments;
                        </li>
                        <li>
                            Reconciling business and accounting
                            records; and
                        </li>
                        <li>
                            Supporting Zetrick's accounting and
                            financial operations.
                        </li>
                    </ul>

                    <h2>Information Sharing</h2>

                    <p>
                        Information obtained through the QuickBooks
                        integration is not sold or rented.
                    </p>

                    <p>
                        Information may be disclosed to service
                        providers when necessary to operate
                        Zetrick's systems, comply with legal
                        obligations, protect Zetrick's rights, or
                        provide the functionality of the
                        Application.
                    </p>

                    <h2>Data Security</h2>

                    <p>
                        Zetrick uses reasonable administrative,
                        technical, and organizational safeguards
                        designed to protect information processed by
                        the Application against unauthorized access,
                        disclosure, alteration, or destruction.
                    </p>

                    <p>
                        Access to the Application and its QuickBooks
                        integration is restricted to authorized
                        users and systems.
                    </p>

                    <h2>QuickBooks Authorization</h2>

                    <p>
                        Access to QuickBooks Online is authorized
                        through Intuit's authentication and
                        authorization services. The Application does
                        not require users to provide their
                        QuickBooks passwords to Zetrick.
                    </p>

                    <p>
                        Authorization to access QuickBooks Online may
                        be revoked through QuickBooks or Intuit's
                        applicable account and application-management
                        functionality.
                    </p>

                    <h2>Data Retention</h2>

                    <p>
                        Information is retained only as reasonably
                        necessary for Zetrick's business,
                        accounting, legal, compliance, and
                        operational purposes.
                    </p>

                    <p>
                        Information obtained from QuickBooks may also
                        exist independently in QuickBooks Online and
                        is subject to Intuit's applicable policies
                        and retention practices.
                    </p>

                    <h2>Third-Party Services</h2>

                    <p>
                        The Application integrates with QuickBooks
                        Online, a service provided by Intuit.
                        Information processed by Intuit is subject
                        to Intuit's applicable privacy policies and
                        terms.
                    </p>

                    <h2>Changes to This Policy</h2>

                    <p>
                        Zetrick may update this Privacy Policy from
                        time to time. Changes will be reflected on
                        this page along with an updated effective
                        date when appropriate.
                    </p>

                    <h2>Contact</h2>

                    <p>
                        Questions regarding this Privacy Policy or
                        the Zetrick QuickBooks Integration may be
                        directed to Zetrick LLC.
                    </p>
                `
        )
    );
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

    <title>${title}</title>

    <style>
        body {
            margin: 0;
            padding: 0;
            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Helvetica,
                Arial,
                sans-serif;
            color: #222;
            background: #fff;
            line-height: 1.6;
        }

        main {
            max-width: 800px;
            margin: 0 auto;
            padding: 48px 24px 80px;
        }

        h1 {
            margin-bottom: 32px;
            font-size: 32px;
        }

        h2 {
            margin-top: 36px;
            margin-bottom: 12px;
            font-size: 21px;
        }

        p,
        li {
            font-size: 16px;
        }

        a {
            color: #1261a0;
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

export function create_quickbooks_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.get("/quickbooks", handle_quickbooks_launch);
        fastify.get("/quickbooks/terms", handle_quickbooks_terms);
        fastify.get("/quickbooks/privacy", handle_quickbooks_privacy);
        fastify.get("/quickbooks/connect", handle_quickbooks_connect);
        fastify.get("/quickbooks/callback", handle_quickbooks_callback);
        fastify.get("/quickbooks/disconnected", handle_quickbooks_disconnected);
    };
}
