import LegalPageShell from '@/components/legal/LegalPageShell'

export default function PermissionsPage() {
  return (
    <LegalPageShell title="Permissions" updatedDate="3 August 2026">
      <p>
        This page explains what access Premnathrail Portal requests when you sign in, and how permissions
        work once you&apos;re inside the Portal.
      </p>

      <h2 style={sectionStyle}>1. Microsoft Sign-In Permissions</h2>
      <p>Signing in with your Microsoft work account grants the Portal permission to:</p>
      <ul style={listStyle}>
        <li>Verify your identity and read your basic work profile (name, email, job title, department, phone).</li>
        <li>Confirm your organization/tenant membership, so only Premnathrail accounts can sign in.</li>
        <li>Nothing beyond this is requested — the Portal does not read your email, files, calendar, or Teams messages.</li>
      </ul>

      <h2 style={sectionStyle}>2. In-Portal Role Permissions</h2>
      <p>Once signed in, what you can see and do is controlled by your assigned role and modules:</p>
      <ul style={listStyle}>
        <li><strong>User</strong> — access to the specific modules (ERP, CRM, R&amp;D, Purchase) an admin has assigned to you.</li>
        <li><strong>Admin</strong> — access to all modules, plus Users &amp; Roles to manage other accounts.</li>
        <li>Within ERP specifically, admins can grant finer-grained permissions (e.g. project view/create/edit/delete).</li>
      </ul>

      <h2 style={sectionStyle}>3. Requesting a Change</h2>
      <p>
        If you need access to a module or permission you don&apos;t currently have, contact your admin —
        changes are made from the Users &amp; Roles page and take effect the next time you load the Portal.
      </p>

      <h2 style={sectionStyle}>4. Contact</h2>
      <p>Questions about permissions can be directed to your Premnathrail IT/HR administrator.</p>

      <p style={{ marginTop: 24, fontSize: 12, color: '#a8825f' }}>
        This is a starting template — have it reviewed by your legal/compliance team before treating it
        as your organization&apos;s official policy.
      </p>
    </LegalPageShell>
  )
}

const sectionStyle: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: '#3a2313', margin: '22px 0 8px' }
const listStyle: React.CSSProperties = { margin: '0 0 12px', paddingLeft: 20 }
