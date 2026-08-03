import LegalPageShell from '@/components/legal/LegalPageShell'

export default function PrivacyPolicyPage() {
  return (
    <LegalPageShell title="Privacy Policy" updatedDate="3 August 2026">
      <p>
        This Privacy Policy explains how Premnathrail Portal (&quot;the Portal&quot;) collects, uses, and
        protects information about employees who sign in and use it.
      </p>

      <h2 style={sectionStyle}>1. Information We Collect</h2>
      <ul style={listStyle}>
        <li>Your work profile from Microsoft/Azure AD sign-in: name, email, designation, department, phone.</li>
        <li>Activity within the Portal: records you create or edit in CRM, ERP, R&amp;D, and Purchase modules.</li>
        <li>Feedback and suggestions you submit through the Portal&apos;s Feedback feature.</li>
        <li>Basic technical data such as sign-in timestamps, used to keep accounts and sessions secure.</li>
      </ul>

      <h2 style={sectionStyle}>2. How We Use This Information</h2>
      <ul style={listStyle}>
        <li>To authenticate you and apply the correct role and module permissions.</li>
        <li>To operate core Portal features (notifications, assignments, audit history).</li>
        <li>To review feedback and improve the Portal.</li>
        <li>To maintain security — detecting misuse and investigating incidents.</li>
      </ul>

      <h2 style={sectionStyle}>3. Data Sharing</h2>
      <p>
        Information in the Portal is only visible to authorized colleagues and administrators within
        Premnathrail, according to their assigned role and module access. We do not sell or share your
        data with external third parties, except where required by law.
      </p>

      <h2 style={sectionStyle}>4. Data Retention</h2>
      <p>
        Records are retained for as long as your account is active and as needed for business and
        compliance purposes. Deactivated accounts are retained in an inactive state rather than deleted,
        so historical records they created remain intact.
      </p>

      <h2 style={sectionStyle}>5. Your Rights</h2>
      <p>
        You may request a copy of the personal information the Portal holds about you, or ask for
        corrections, by contacting your administrator.
      </p>

      <h2 style={sectionStyle}>6. Contact</h2>
      <p>Questions about this policy can be directed to your Premnathrail IT/HR administrator.</p>

      <p style={{ marginTop: 24, fontSize: 12, color: '#a8825f' }}>
        This is a starting template — have it reviewed by your legal/compliance team before treating it
        as your organization&apos;s official policy.
      </p>
    </LegalPageShell>
  )
}

const sectionStyle: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: '#3a2313', margin: '22px 0 8px' }
const listStyle: React.CSSProperties = { margin: '0 0 12px', paddingLeft: 20 }
