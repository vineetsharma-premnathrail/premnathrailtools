import LegalPageShell from '@/components/legal/LegalPageShell'

export default function TermsOfUsePage() {
  return (
    <LegalPageShell title="Terms of Use" updatedDate="3 August 2026">
      <p>
        These Terms of Use govern access to and use of Premnathrail Portal (&quot;the Portal&quot;) by
        Premnathrail employees and authorized users. By signing in, you agree to these terms.
      </p>

      <h2 style={sectionStyle}>1. Authorized Use</h2>
      <ul style={listStyle}>
        <li>The Portal is provided for legitimate business use by Premnathrail employees only.</li>
        <li>Sign in with your own official work account — do not share credentials or sessions with others.</li>
        <li>Access is limited to the modules and permissions assigned to your role (see Users &amp; Roles).</li>
      </ul>

      <h2 style={sectionStyle}>2. Acceptable Use</h2>
      <ul style={listStyle}>
        <li>Do not attempt to bypass access controls, probe for vulnerabilities, or access data outside your assigned permissions.</li>
        <li>Do not upload unlawful, confidential-to-third-parties, or malicious content.</li>
        <li>Use the Feedback feature constructively — abusive or spam submissions may result in account review.</li>
      </ul>

      <h2 style={sectionStyle}>3. Data Accuracy</h2>
      <p>
        Records you create or edit (CRM, ERP, R&amp;D, Purchase) should be accurate and up to date, as
        other teams rely on them for business decisions.
      </p>

      <h2 style={sectionStyle}>4. Account Suspension</h2>
      <p>
        Premnathrail may deactivate accounts that violate these terms, leave the organization, or pose a
        security risk. Deactivation revokes Portal access but preserves historical records.
      </p>

      <h2 style={sectionStyle}>5. Changes to the Portal</h2>
      <p>
        Features, modules, and these terms may change over time — see the &quot;What&apos;s New&quot;
        panel for a log of recent updates.
      </p>

      <h2 style={sectionStyle}>6. Contact</h2>
      <p>Questions about these terms can be directed to your Premnathrail IT/HR administrator.</p>

      <p style={{ marginTop: 24, fontSize: 12, color: '#a8825f' }}>
        This is a starting template — have it reviewed by your legal/compliance team before treating it
        as your organization&apos;s official terms.
      </p>
    </LegalPageShell>
  )
}

const sectionStyle: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: '#3a2313', margin: '22px 0 8px' }
const listStyle: React.CSSProperties = { margin: '0 0 12px', paddingLeft: 20 }
