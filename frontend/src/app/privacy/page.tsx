export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-6 text-3xl font-bold">Privacy Policy</h1>
      <p className="mb-4 text-sm text-muted-foreground">Last updated: March 2026</p>

      <div className="prose prose-invert prose-sm max-w-none space-y-4 text-muted-foreground">
        <h2 className="text-lg font-semibold text-foreground">1. Information We Collect</h2>
        <p>When you use Squad Whitelister, we collect:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Discord user ID, username, and avatar (via OAuth2)</li>
          <li>Discord server memberships and roles (to determine whitelist access)</li>
          <li>Steam64 IDs and/or EOS IDs that you voluntarily submit</li>
          <li>Steam player names (cached from Steam&apos;s public API)</li>
          <li>Audit logs of whitelist actions (submissions, edits, removals)</li>
        </ul>

        <h2 className="text-lg font-semibold text-foreground">2. How We Use Your Data</h2>
        <p>Your data is used exclusively to:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Authenticate you via Discord OAuth2</li>
          <li>Determine your whitelist tier based on Discord roles</li>
          <li>Generate whitelist files for Squad game servers</li>
          <li>Display your whitelist information on the dashboard</li>
          <li>Provide admin tools for server managers</li>
        </ul>

        <h2 className="text-lg font-semibold text-foreground">3. Data Sharing</h2>
        <p>
          We do not sell, rent, or share your personal data with third parties.
          Your Steam IDs are included in whitelist files that are served to
          your community&apos;s Squad game server via a secure, unique URL.
        </p>

        <h2 className="text-lg font-semibold text-foreground">4. Data Storage</h2>
        <p>
          Your data is stored in a PostgreSQL database hosted on Railway.
          Session data is stored in encrypted cookies. We use HTTPS for all
          communications.
        </p>

        <h2 className="text-lg font-semibold text-foreground">5. Data Retention</h2>
        <p>
          Active whitelist entries are retained as long as you maintain your
          Discord role. Inactive entries are automatically purged after the
          retention period configured by your server administrator (default 90 days).
        </p>

        <h2 className="text-lg font-semibold text-foreground">6. Your Rights</h2>
        <p>You can:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>View your stored data via the My Whitelist page</li>
          <li>Edit or delete your Steam/EOS IDs at any time</li>
          <li>Request complete data deletion by contacting your server admin</li>
          <li>Revoke Discord OAuth2 access in your Discord settings</li>
        </ul>

        <h2 className="text-lg font-semibold text-foreground">7. Cookies</h2>
        <p>
          We use a single encrypted session cookie (wl_session) for authentication.
          It expires after 24 hours. We do not use tracking cookies or analytics.
        </p>

        <h2 className="text-lg font-semibold text-foreground">8. Contact</h2>
        <p>
          For privacy concerns, contact us via the Squad Whitelister Discord community.
        </p>
      </div>

      <div className="mt-8">
        <a href="/" className="text-sm hover:underline" style={{ color: "var(--accent-primary)" }}>
          Back to home
        </a>
      </div>
    </div>
  );
}
