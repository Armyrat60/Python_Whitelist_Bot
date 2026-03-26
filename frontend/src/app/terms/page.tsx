export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-6 text-3xl font-bold">Terms of Service</h1>
      <p className="mb-4 text-sm text-muted-foreground">Last updated: March 2026</p>

      <div className="prose prose-invert prose-sm max-w-none space-y-4 text-muted-foreground">
        <h2 className="text-lg font-semibold text-foreground">1. Service Description</h2>
        <p>
          Squad Whitelister is a Discord bot and web dashboard that manages whitelist access
          for Squad game servers. The service allows server administrators to configure
          role-based whitelist tiers and generate RemoteAdminList files.
        </p>

        <h2 className="text-lg font-semibold text-foreground">2. User Accounts</h2>
        <p>
          You sign in using your Discord account via OAuth2. We do not create separate
          accounts or store passwords. Your access level is determined by your Discord
          roles within your server.
        </p>

        <h2 className="text-lg font-semibold text-foreground">3. Data We Store</h2>
        <p>
          We store your Discord user ID, username, server memberships, and any Steam64
          or EOS IDs you submit. We also store audit logs of whitelist actions.
        </p>

        <h2 className="text-lg font-semibold text-foreground">4. Acceptable Use</h2>
        <p>
          You agree not to abuse the service, attempt to access other users&apos; data,
          or use the service for any illegal purpose. Server administrators are responsible
          for managing their community&apos;s whitelist appropriately.
        </p>

        <h2 className="text-lg font-semibold text-foreground">5. Service Availability</h2>
        <p>
          We strive to maintain high availability but do not guarantee uninterrupted
          service. The service may be temporarily unavailable for maintenance or updates.
        </p>

        <h2 className="text-lg font-semibold text-foreground">6. Termination</h2>
        <p>
          We reserve the right to terminate access to the service for any reason,
          including violation of these terms.
        </p>

        <h2 className="text-lg font-semibold text-foreground">7. Contact</h2>
        <p>
          For questions about these terms, contact us via the Squad Whitelister
          Discord community.
        </p>
      </div>

      <div className="mt-8">
        <a href="/" className="text-sm text-orange-400 hover:underline">
          Back to home
        </a>
      </div>
    </div>
  );
}
