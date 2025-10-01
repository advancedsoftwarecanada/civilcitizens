export const metadata = {
  title: 'Privacy Policy – Civil Citizens',
}

export default function PrivacyPage() {
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
      <p className="text-sm text-gray-600 mb-8">Last updated: {today}</p>

      <section className="space-y-4">
        <p>
          This Privacy Policy explains how Civil Citizens ("we", "us", "our") collects, uses, and protects your
          information when you use our services. By using Civil Citizens, you agree to the practices described here.
        </p>

        <h2 className="text-xl font-semibold mt-6">Information We Collect</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Account details (e.g., name, handle, email)</li>
          <li>Content you create (posts, comments, media)</li>
          <li>Usage data and device information (e.g., IP address, browser)</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">How We Use Information</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Provide and improve the service</li>
          <li>Secure accounts and prevent abuse</li>
          <li>Communicate with you about updates and support</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">Sharing and Disclosure</h2>
        <p>
          We do not sell your personal information. We may share data with service providers that help us operate the
          platform, or when required by law. Public content you post may be visible to others as designed by the platform.
        </p>

        <h2 className="text-xl font-semibold mt-6">Data Retention</h2>
        <p>
          We retain information for as long as your account is active or as needed to provide the service and comply with
          legal obligations.
        </p>

        <h2 className="text-xl font-semibold mt-6">Your Rights</h2>
        <p>
          Depending on your location, you may have rights to access, correct, or delete your information. Contact us to
          make a request and we will respond as required by applicable law.
        </p>

        <h2 className="text-xl font-semibold mt-6">Security</h2>
        <p>
          We implement safeguards designed to protect your information. No system is perfectly secure; please use strong
          passwords and keep your credentials confidential.
        </p>

        <h2 className="text-xl font-semibold mt-6">Contact</h2>
        <p>
          Questions about this policy? Contact us at support@civilcitizens.ca.
        </p>

        <h2 className="text-xl font-semibold mt-6">Changes to this Policy</h2>
        <p>
          We may update this policy from time to time. If we make material changes, we will provide notice as appropriate.
        </p>
      </section>
    </div>
  )
}
