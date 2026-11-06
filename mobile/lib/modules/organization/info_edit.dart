import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

/// Edit sheets of Organization › Info - the phone version of
/// frontend/src/app/dashboard/organization/info/edit/page.tsx (one sheet per
/// tab of the portal's edit page) and CompanyPartnersPanel.tsx.

/// IANA zones offered in the Time Zone select (Asia/Kolkata first, like the portal).
const infoTimeZones = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Bangkok',
  'Asia/Jakarta', 'Asia/Karachi', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Colombo', 'Asia/Riyadh', 'Asia/Qatar',
  'Asia/Muscat', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Tehran', 'Asia/Seoul', 'Asia/Manila', 'Asia/Kuala_Lumpur',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
  'Europe/Zurich', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Istanbul', 'Europe/Moscow', 'Africa/Johannesburg',
  'Africa/Cairo', 'Africa/Nairobi', 'Africa/Lagos', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo', 'America/Mexico_City', 'Australia/Sydney',
  'Australia/Melbourne', 'Australia/Perth', 'Pacific/Auckland', 'UTC',
];

const _documentTypes = ['License', 'Certificate', 'Registration', 'Agreement', 'Legal', 'Tax', 'Other'];
const _confidentialityLevels = ['Public', 'Internal', 'Confidential'];

/// Section label inside a sheet (portal SheetSection title).
class _SheetTitle extends StatelessWidget {
  const _SheetTitle(this.text, {this.optional = false});
  final String text;
  final bool optional;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(children: [
          Caps(text, color: Brand.heading),
          if (optional) ...[const SizedBox(width: 6), const Text('(optional)', style: TextStyle(fontSize: 11, color: Brand.muted))],
        ]),
      );
}

class _Hint extends StatelessWidget {
  const _Hint(this.text, {this.warn = false});
  final String text;
  final bool warn;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: TextStyle(fontSize: 12, color: warn ? const Color(0xFFB45309) : Brand.muted, height: 1.4));
}

// ── Field helpers over a mutable map ────────────────────────────────────────

Widget _text(Json f, String key, String label,
    {bool req = false, String? hint, int maxLines = 1, bool number = false, bool upper = false, bool keepEmpty = false}) {
  final v = f[key];
  return AppTextField(
    label: label,
    required: req,
    hint: hint,
    maxLines: maxLines,
    keyboardType: number ? AppTextField.number : null,
    initialValue: v == null ? '' : (v is num ? _fmtPlain(v) : v.toString()),
    onChanged: (s) {
      final t = upper ? s.toUpperCase() : s;
      if (number) {
        f[key] = t.trim().isEmpty ? null : num.tryParse(t.trim());
      } else {
        f[key] = (t.isEmpty && !keepEmpty) ? null : t;
      }
    },
  );
}

String _fmtPlain(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

Widget _date(Json f, String key, String label, StateSetter setS, {bool req = false}) => DateField(
      label: label,
      required: req,
      value: f[key] is String && (f[key] as String).isNotEmpty ? DateTime.tryParse(f[key] as String) : null,
      onChanged: (d) => setS(() => f[key] = d == null ? null : apiDate(d)),
    );

Widget _check(Json f, String key, String label, StateSetter setS) =>
    CheckField(label: label, value: f[key] == true, onChanged: (v) => setS(() => f[key] = v));

// ── Company record sheets (Basic, Legal, Tax, Branding, Defaults) ──────────

/// Sections of the company record that save with the one company PATCH
/// (or POST on first setup).
enum CompanySection { basic, legal, tax, branding, defaults }

Future<bool> editCompanySection(BuildContext context, CompanySection section, Json? company,
    {Map<int, String> plantNames = const {}, Map<int, String> storeNames = const {}}) {
  final isNew = company == null;
  final f = Json.from(company ?? const {});
  final title = switch (section) {
    CompanySection.basic => isNew ? 'Set Up Company Info' : 'Edit Basic',
    CompanySection.legal => 'Edit Legal & Registration',
    CompanySection.tax => 'Edit Tax Configuration',
    CompanySection.branding => 'Edit Branding',
    CompanySection.defaults => 'Edit Defaults & Controls',
  };
  final plants = Map<int, String>.of(plantNames);
  final stores = Map<int, String>.of(storeNames);
  return showFormSheet(
    context,
    title: title,
    saveLabel: isNew ? 'Save' : 'Save Changes',
    builder: (ctx, setS) => switch (section) {
      CompanySection.basic => [
          if (isNew)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                  color: const Color(0xFFFFF7ED),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFFED7AA))),
              child: const Text(
                  "Company info hasn't been set up yet. Fill in at least Name and Code and Save — Address, Contacts, "
                  'Financial Year, and Documents can only be added after that first save.',
                  style: TextStyle(fontSize: 12.5, color: Color(0xFF9A3412))),
            ),
          const _SheetTitle('Basic Information'),
          _text(f, 'name', 'Company Name', req: true, keepEmpty: true),
          _text(f, 'legal_name', 'Legal Name', req: true),
          _text(f, 'short_name', 'Short Name'),
          _text(f, 'code', 'Code', req: true, upper: true),
          _text(f, 'company_type', 'Company Type', hint: 'Private Limited'),
          _text(f, 'industry', 'Industry'),
          _text(f, 'business_nature', 'Business Nature'),
          _text(f, 'website', 'Website'),
          _text(f, 'description', 'Description', maxLines: 3),
          _date(f, 'date_of_incorporation', 'Date of Incorporation', setS),
          const _SheetTitle('Locale'),
          _text(f, 'country', 'Country', req: true),
          _text(f, 'currency', 'Default Currency', req: true, hint: 'INR'),
          _text(f, 'default_language', 'Default Language', hint: 'English'),
          AppSelect<String>(
            label: 'Time Zone',
            required: true,
            value: str(f['timezone']).isEmpty ? null : str(f['timezone']),
            valueLabel: infoTimeZones.contains(f['timezone'])
                ? null
                : '${f['timezone']} (not a valid time zone — pick one)',
            options: [for (final z in infoTimeZones) Option(z, z)],
            onChanged: (o) => setS(() => f['timezone'] = o?.value),
          ),
        ],
      CompanySection.legal => [
          const _SheetTitle('Legal & Registration'),
          _text(f, 'legal_entity_type', 'Legal Entity Type', hint: 'Private Limited Company'),
          _text(f, 'legal_status', 'Legal Status', hint: 'Active'),
          _text(f, 'cin', 'CIN'),
          _text(f, 'pan', 'PAN'),
          _text(f, 'tan', 'TAN'),
          _text(f, 'gstin', 'GSTIN'),
          _text(f, 'udyam_registration_no', 'Udyam Registration No.'),
          _text(f, 'iec', 'IEC'),
          _text(f, 'msme_registration_no', 'MSME Registration No.'),
          _text(f, 'pf_registration_no', 'PF Registration No.'),
          _text(f, 'esic_registration_no', 'ESIC Registration No.'),
          const _SheetTitle('Other Registration', optional: true),
          _text(f, 'other_registration_type', 'Other Registration Type'),
          _text(f, 'other_registration_number', 'Registration Number'),
          _text(f, 'issuing_authority', 'Issuing Authority'),
          _date(f, 'other_registration_date', 'Registration Date', setS),
          _date(f, 'expiry_date', 'Expiry Date', setS),
          const _SheetTitle('Representative & Capital'),
          _text(f, 'legal_representative', 'Legal Representative'),
          _text(f, 'authorized_capital', 'Authorized Capital', number: true),
          _text(f, 'paid_up_capital', 'Paid-up Capital', number: true),
          const _Hint(
              'Legal documents (licenses, certificates, agreements) are managed from the Documents tab on the Info page.'),
        ],
      CompanySection.tax => [
          const _SheetTitle('Tax Configuration'),
          _text(f, 'gst_registration_type', 'GST Registration Type', hint: 'Regular'),
          _text(f, 'default_tax_region', 'Default Tax Region'),
          _text(f, 'tax_deductibility', 'Tax Deductibility'),
          _text(f, 'tax_registration_status', 'Tax Registration Status', hint: 'Active'),
          _date(f, 'tax_effective_date', 'Tax Effective Date', setS),
          _check(f, 'tds_applicable', 'TDS Applicable', setS),
          _check(f, 'tcs_applicable', 'TCS Applicable', setS),
          const _Hint(
              'Tax documents (registration certificates, filings) are managed from the Documents tab on the Info page.'),
        ],
      CompanySection.branding => [
          const _SheetTitle('Logo & Colors'),
          _text(f, 'logo_url', 'Company Logo URL'),
          _text(f, 'primary_brand_color', 'Primary Brand Color', hint: '#FF7A45'),
          _text(f, 'secondary_brand_color', 'Secondary Brand Color', hint: '#1F1108'),
          _text(f, 'accent_color', 'Accent Color', hint: '#3B82F6'),
          const _SheetTitle('Documents & Email'),
          _text(f, 'company_header', 'Company Header', maxLines: 3, hint: 'Text shown at the top of generated documents'),
          _text(f, 'company_footer', 'Company Footer', maxLines: 3, hint: 'Text shown at the bottom of generated documents'),
          _text(f, 'watermark', 'Watermark', hint: 'e.g. DRAFT, or a watermark image URL'),
          _text(f, 'email_signature', 'Email Signature', maxLines: 4),
        ],
      CompanySection.defaults => [
          const _SheetTitle('Company Defaults & Controls'),
          _text(f, 'default_tax', 'Default Tax', hint: 'GST 18%'),
          AppSelect<int>(
            label: 'Default Plant',
            value: asInt(f['default_plant_id']),
            valueLabel: plants[asInt(f['default_plant_id'])] ?? 'Plant #${f['default_plant_id']}',
            loadOptions: loadBranchOptions,
            onChanged: (o) => setS(() {
              f['default_plant_id'] = o?.value;
              if (o != null) plants[o.value] = o.label;
            }),
          ),
          AppSelect<int>(
            label: 'Default Store',
            value: asInt(f['default_warehouse_id']),
            valueLabel: stores[asInt(f['default_warehouse_id'])] ?? 'Store #${f['default_warehouse_id']}',
            loadOptions: loadStoreLocationOptions,
            onChanged: (o) => setS(() {
              f['default_warehouse_id'] = o?.value;
              if (o != null) stores[o.value] = o.label;
            }),
          ),
          _text(f, 'default_cost_center', 'Default Cost Center'),
          _text(f, 'default_profit_center', 'Default Profit Center'),
        ],
    },
    onSave: () async {
      if (str(f['name']).trim().isEmpty) throw 'Company name is required — enter it on the Basic tab.';
      if (str(f['code']).trim().isEmpty) throw 'Company code is required — enter it on the Basic tab (e.g. PNR).';
      f['code'] = str(f['code']).toUpperCase();
      if (isNew) {
        await Api.post('/organization/company', data: f);
      } else {
        await Api.patch('/organization/company', data: f);
      }
    },
  );
}

/// Store locations (portal storeApi.listLocations) for Default Store.
Future<List<Option<int>>> loadStoreLocationOptions(String search) async {
  final rows = (await Api.list('/store/locations')).rows;
  final q = search.toLowerCase();
  return [
    for (final l in rows)
      if (q.isEmpty || str(l['name']).toLowerCase().contains(q)) Option<int>(asInt(l['id'])!, str(l['name'])),
  ];
}

// ── Address ─────────────────────────────────────────────────────────────────

Future<bool> editCompanyAddress(BuildContext context, Json? a) {
  final f = <String, dynamic>{
    'address_type': str(a?['address_type']),
    'address_line1': str(a?['address_line1']),
    'address_line2': str(a?['address_line2']),
    'landmark': str(a?['landmark']),
    'country': str(a?['country']),
    'state': str(a?['state']),
    'city': str(a?['city']),
    'district': str(a?['district']),
    'pincode': str(a?['pincode']),
    'is_primary': a?['is_primary'] == true,
    'is_active': a == null ? true : a['is_active'] == true,
  };
  return showFormSheet(
    context,
    title: a == null ? 'Add Address' : 'Edit Address',
    saveLabel: a == null ? 'Save Address' : 'Save Changes',
    builder: (ctx, setS) => [
      _text(f, 'address_type', 'Address Type', hint: 'Registered Office', keepEmpty: true),
      _text(f, 'landmark', 'Landmark', keepEmpty: true),
      _text(f, 'address_line1', 'Address Line 1', req: true, keepEmpty: true),
      _text(f, 'address_line2', 'Address Line 2', keepEmpty: true),
      _text(f, 'country', 'Country', keepEmpty: true),
      _text(f, 'state', 'State / UT', keepEmpty: true),
      _text(f, 'city', 'City', keepEmpty: true),
      _text(f, 'district', 'District', keepEmpty: true),
      _text(f, 'pincode', 'PIN Code', keepEmpty: true),
      _check(f, 'is_primary', 'Primary', setS),
      _check(f, 'is_active', 'Active', setS),
    ],
    onSave: () async {
      if (str(f['address_line1']).trim().isEmpty) throw 'Address Line 1 is required — enter the building / street.';
      if (a == null) {
        await Api.post('/organization/company/addresses', data: f);
      } else {
        await Api.patch('/organization/company/addresses/${a['id']}', data: f);
      }
    },
  );
}

// ── Contacts ────────────────────────────────────────────────────────────────

Future<bool> editCompanyContact(BuildContext context, Json? c) {
  final f = <String, dynamic>{
    for (final k in const [
      'contact_type', 'contact_person', 'designation', 'department', 'mobile', 'phone', 'email', 'alternate_email',
      'communication_preference'
    ])
      k: str(c?[k]),
    'is_primary': c?['is_primary'] == true,
    'is_active': c == null ? true : c['is_active'] == true,
  };
  return showFormSheet(
    context,
    title: c == null ? 'Add Contact' : 'Edit Contact',
    saveLabel: c == null ? 'Save Contact' : 'Save Changes',
    builder: (ctx, setS) => [
      _text(f, 'contact_person', 'Contact Person', req: true, keepEmpty: true),
      _text(f, 'contact_type', 'Contact Type', hint: 'Primary', keepEmpty: true),
      _text(f, 'designation', 'Designation', keepEmpty: true),
      _text(f, 'department', 'Department', keepEmpty: true),
      _text(f, 'mobile', 'Mobile', keepEmpty: true),
      _text(f, 'phone', 'Phone', keepEmpty: true),
      _text(f, 'email', 'Email', keepEmpty: true),
      _text(f, 'alternate_email', 'Alternate Email', keepEmpty: true),
      _text(f, 'communication_preference', 'Communication Preference', hint: 'Email', keepEmpty: true),
      _check(f, 'is_primary', 'Primary', setS),
      _check(f, 'is_active', 'Active', setS),
    ],
    onSave: () async {
      if (str(f['contact_person']).trim().isEmpty) throw "Contact Person is required — enter the person's name.";
      if (c == null) {
        await Api.post('/organization/company/contacts', data: f);
      } else {
        await Api.patch('/organization/company/contacts/${c['id']}', data: f);
      }
    },
  );
}

// ── Financial year ──────────────────────────────────────────────────────────

Future<bool> editFinancialYear(BuildContext context, Json? fy) {
  final f = <String, dynamic>{
    'name': str(fy?['name']),
    'start_date': fy?['start_date'],
    'end_date': fy?['end_date'],
    'fiscal_year_code': str(fy?['fiscal_year_code']),
    // Legacy statuses (e.g. 'locked') map to Open - the select only offers Open/Closed.
    'status': fy?['status'] == 'closed' ? 'closed' : 'open',
    'lock_date': fy?['lock_date'],
    'period_closing_rule': str(fy?['period_closing_rule']),
    'number_series_reset': fy?['number_series_reset'] == true,
  };
  return showFormSheet(
    context,
    title: fy == null ? 'Add Financial Year' : 'Edit Financial Year',
    saveLabel: fy == null ? 'Save Financial Year' : 'Save Changes',
    builder: (ctx, setS) => [
      _text(f, 'name', 'Financial Year Name', req: true, hint: 'FY 2025-26', keepEmpty: true),
      _date(f, 'start_date', 'Start Date', setS, req: true),
      _date(f, 'end_date', 'End Date', setS, req: true),
      _text(f, 'fiscal_year_code', 'Fiscal Year Code', keepEmpty: true),
      AppSelect<String>(
        label: 'Status',
        value: f['status'] as String,
        required: true,
        options: const [Option('open', 'Open'), Option('closed', 'Closed')],
        onChanged: (o) => setS(() => f['status'] = o?.value ?? 'open'),
      ),
      _date(f, 'lock_date', 'Lock Date', setS),
      _text(f, 'period_closing_rule', 'Period Closing Rule', keepEmpty: true),
      _check(f, 'number_series_reset', 'Reset number series', setS),
    ],
    onSave: () async {
      if (str(f['name']).trim().isEmpty || str(f['start_date']).isEmpty || str(f['end_date']).isEmpty) {
        throw 'Name, Start Date, and End Date are required — e.g. FY 2025-26, 01-04-2025 to 31-03-2026.';
      }
      final payload = Json.from(f)
        ..['lock_date'] = str(f['lock_date']).isEmpty ? null : f['lock_date']
        ..['fiscal_year_code'] = str(f['fiscal_year_code']).isEmpty ? null : f['fiscal_year_code']
        ..['period_closing_rule'] = str(f['period_closing_rule']).isEmpty ? null : f['period_closing_rule'];
      if (fy == null) {
        await Api.post('/organization/company/financial-years', data: payload);
      } else {
        await Api.patch('/organization/company/financial-years/${fy['id']}', data: payload);
      }
    },
  );
}

// ── Documents ───────────────────────────────────────────────────────────────

Future<bool> uploadCompanyDocument(BuildContext context) {
  MultipartFile? file;
  final f = <String, dynamic>{
    'document_type': 'Other',
    'document_name': '',
    'document_number': '',
    'issue_date': null,
    'expiry_date': null,
    'issuing_authority': '',
    'description': '',
    'confidentiality': 'Internal',
    'tags': '',
    'remarks': '',
  };
  return showFormSheet(
    context,
    title: 'Add Company Document',
    saveLabel: 'Save Document',
    builder: (ctx, setS) => [
      InputDecorator(
        decoration: fieldDecoration('Document File', required: true),
        child: Row(
          children: [
            Expanded(
              child: Text(file?.filename ?? 'No file chosen',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 14, color: file == null ? Brand.muted : Brand.body)),
            ),
            if (file != null)
              IconButton(
                  tooltip: 'Remove',
                  icon: const Icon(Icons.close_rounded, size: 18),
                  onPressed: () => setS(() => file = null)),
            OutlinedButton.icon(
              icon: const Icon(Icons.attach_file_rounded, size: 18),
              label: Text(file == null ? 'Choose' : 'Change'),
              onPressed: () async {
                try {
                  final picked = await Files.pickFile();
                  if (picked != null) setS(() => file = picked);
                } catch (e) {
                  if (ctx.mounted) showSnack(ctx, ApiClient.describe(e), error: true);
                }
              },
            ),
          ],
        ),
      ),
      AppSelect<String>(
        label: 'Document Type',
        required: true,
        value: f['document_type'] as String,
        options: [for (final t in _documentTypes) Option(t, t)],
        onChanged: (o) => setS(() => f['document_type'] = o?.value ?? 'Other'),
      ),
      _text(f, 'document_name', 'Document Name', req: true, keepEmpty: true),
      _text(f, 'document_number', 'Document Number', keepEmpty: true),
      _date(f, 'issue_date', 'Issue Date', setS),
      _date(f, 'expiry_date', 'Expiry Date', setS),
      _text(f, 'issuing_authority', 'Issuing Authority', keepEmpty: true),
      AppSelect<String>(
        label: 'Confidentiality',
        value: f['confidentiality'] as String,
        required: true,
        options: [for (final c in _confidentialityLevels) Option(c, c)],
        onChanged: (o) => setS(() => f['confidentiality'] = o?.value ?? 'Internal'),
      ),
      _text(f, 'tags', 'Tags (comma separated)', keepEmpty: true),
      _text(f, 'description', 'Description', keepEmpty: true),
      _text(f, 'remarks', 'Remarks', keepEmpty: true),
    ],
    onSave: () async {
      if (file == null) throw 'Select a file to upload — tap Choose next to Document File.';
      if (str(f['document_name']).trim().isEmpty) {
        throw 'Document Name is required — e.g. GST Registration Certificate.';
      }
      final form = FormData();
      form.files.add(MapEntry('file', file!));
      f.forEach((k, v) {
        final s = str(v);
        if (s.isNotEmpty) form.fields.add(MapEntry(k, s));
      });
      await Api.dio.post('/organization/company/documents',
          data: form,
          options: Options(sendTimeout: const Duration(seconds: 120), receiveTimeout: const Duration(seconds: 120)));
    },
  );
}

// ── Partners ────────────────────────────────────────────────────────────────

/// Manage Partners (CompanyPartnersPanel): the company's top approval level.
Future<bool> editPartners(BuildContext context, List<Json> partners) {
  var draft = <int, String>{for (final p in partners) asInt(p['id'])!: str(p['name'])};
  return showFormSheet(
    context,
    title: 'Manage Partners',
    saveLabel: 'Save partners',
    builder: (ctx, setS) => [
      const _Hint("The company's top approval level — pick them from the users synced from Azure."),
      const _SheetTitle('Partners'),
      ChipsPicker(
        label: 'Partner users',
        selected: draft,
        loadOptions: loadUserOptions,
        onChanged: (m) => setS(() => draft = m),
      ),
      draft.isEmpty
          ? const _Hint(
              'With no partners, nobody can give the final approval on legacy purchase orders still waiting for a Partner.',
              warn: true)
          : const _Hint(
              'Partners give the final approval on legacy purchase orders, receive escalations, and are the default signatory on letters and certificates.'),
    ],
    onSave: () async {
      await Api.put('/organization/company/partners', data: {'user_ids': draft.keys.toList()});
    },
  );
}
