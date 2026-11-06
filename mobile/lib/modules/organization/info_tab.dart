import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'info_edit.dart';
import 'org_common.dart';

/// Organization › Info - native copy of
/// frontend/src/app/dashboard/organization/info/page.tsx. The portal's
/// separate edit page becomes one edit sheet per tab here.
class OrgInfoTab extends StatefulWidget {
  const OrgInfoTab({super.key});

  @override
  State<OrgInfoTab> createState() => _OrgInfoTabState();
}

const _tabs = [
  'Basic',
  'Address',
  'Legal & Registration',
  'Tax Configuration',
  'Partners',
  'Contacts',
  'Financial Year',
  'Branding',
  'Documents',
  'Defaults & Controls',
];

const _green = Color(0xFF047857);
const _red = Color(0xFFB91C1C);
const _grey = Color(0xFF64748B);

bool _feat(String feature, String action) => Perm.canFeature('organization', 'info', feature, action);

class _InfoData {
  Json? company;
  bool notSetUp = false;
  List<Json> addresses = [];
  List<Json> contacts = [];
  List<Json> financialYears = [];
  List<Json> documents = [];
  List<Json>? partners;
  String? partnersError;
  Map<int, String> plantNames = {};
  Map<int, String> storeNames = {};
}

class _OrgInfoTabState extends State<OrgInfoTab> {
  String _tab = 'Basic';

  bool get _seeStatutory => _feat('statutory', 'view');
  bool get _seeFy => _feat('financial_years', 'view');
  bool get _seeDocs => _feat('documents', 'view');
  bool get _seePartners => _feat('partners', 'view');
  bool get _canEdit => orgCan('info', 'edit');

  bool _seeTab(String t) => switch (t) {
        'Legal & Registration' || 'Tax Configuration' => _seeStatutory,
        'Partners' => _seePartners,
        'Financial Year' => _seeFy,
        'Documents' => _seeDocs,
        _ => true,
      };

  Future<_InfoData> _load() async {
    final d = _InfoData();
    try {
      d.company = jsonMap(await Api.get('/organization/company'));
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) {
        d.notSetUp = true;
        return d;
      }
      rethrow;
    }
    final res = await Future.wait([
      Api.list('/organization/company/addresses'),
      Api.list('/organization/company/contacts'),
      _seeFy ? Api.list('/organization/company/financial-years') : Future.value(ApiPage(const [])),
      _seeDocs ? Api.list('/organization/company/documents') : Future.value(ApiPage(const [])),
    ]);
    d.addresses = res[0].rows;
    d.contacts = res[1].rows;
    d.financialYears = res[2].rows;
    d.documents = res[3].rows;
    if (_seePartners) {
      try {
        d.partners = (await Api.list('/organization/company/partners')).rows;
      } catch (e) {
        d.partnersError = ApiClient.describe(e);
      }
    }
    final c = d.company!;
    // Names for the default plant / store (read-only lookup; falls back to the number).
    if (c['default_plant_id'] != null) {
      try {
        for (final b in (await Api.list('/organization/branches')).rows) {
          d.plantNames[asInt(b['id'])!] = str(b['name']);
        }
      } catch (_) {}
    }
    if (c['default_warehouse_id'] != null) {
      try {
        for (final l in (await Api.list('/store/locations')).rows) {
          d.storeNames[asInt(l['id'])!] = str(l['name']);
        }
      } catch (_) {}
    }
    return d;
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<_InfoData>(
      load: _load,
      builder: (ctx, d, reload) => _page(ctx, d, reload),
    );
  }

  /// The section the header "Edit" opens for the current tab (null = list tab).
  CompanySection? _sectionFor(String t) => switch (t) {
        'Basic' => CompanySection.basic,
        'Legal & Registration' => _feat('statutory', 'edit') ? CompanySection.legal : null,
        'Tax Configuration' => _feat('statutory', 'edit') ? CompanySection.tax : null,
        'Branding' => CompanySection.branding,
        'Defaults & Controls' => CompanySection.defaults,
        _ => null,
      };

  Widget _page(BuildContext context, _InfoData d, VoidCallback reload) {
    final tab = _seeTab(_tab) ? _tab : 'Basic';
    final section = _sectionFor(tab);
    Future<void> edit(CompanySection s) async {
      final ok = await editCompanySection(context, s, d.company, plantNames: d.plantNames, storeNames: d.storeNames);
      if (ok) reload();
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: 32),
      children: [
        PageHeader(
          'Info',
          subtitle:
              'Master information about this organization — used on letterheads, invoices, and other generated documents.',
          actions: [
            if ((d.company != null || d.notSetUp) && _canEdit && (d.notSetUp || section != null))
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: () => edit(d.notSetUp ? CompanySection.basic : section!),
                child: Text(d.notSetUp ? 'Set Up' : 'Edit'),
              ),
          ],
        ),
        if (d.notSetUp)
          const DetailSection("Company info hasn't been set up yet", children: [
            Text(
                'Tap "Set Up" above to add your organization\'s name, address, and other master details.',
                style: TextStyle(fontSize: 13, color: Brand.muted)),
          ])
        else ...[
          _summary(d),
          SizedBox(
            height: 46,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              children: [
                for (final t in _tabs.where(_seeTab))
                  CountChip(t, null, selected: t == tab, onTap: () => setState(() => _tab = t)),
              ],
            ),
          ),
          ..._tabBody(context, tab, d, reload, edit),
        ],
      ],
    );
  }

  Widget _summary(_InfoData d) {
    final c = d.company!;
    final currentFy = d.financialYears.where((f) => f['status'] == 'open').firstOrNull;
    final legal = str(c['legal_name']);
    final text = str(c['description']).isNotEmpty
        ? str(c['description'])
        : (legal.isNotEmpty && legal != str(c['name']) ? 'Registered as $legal.' : '');
    final meta = [
      'Code ${txt(c['code'])}',
      if (str(c['gstin']).isNotEmpty && _seeStatutory) 'GSTIN ${c['gstin']}',
      if (str(c['country']).isNotEmpty) str(c['country']),
    ].join('  ·  ');
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(str(c['name']),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
              if (text.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(text, style: const TextStyle(fontSize: 13, color: Brand.body)),
              ],
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(meta, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  if (currentFy != null) StatusBadge('${currentFy['name']} open', color: _green),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _editAction(CompanySection s, Future<void> Function(CompanySection) edit) =>
      TextButton(onPressed: () => edit(s), child: const Text('Edit'));

  List<Widget> _tabBody(BuildContext context, String tab, _InfoData d, VoidCallback reload,
      Future<void> Function(CompanySection) edit) {
    final c = d.company!;
    Widget? act(CompanySection s) => _canEdit && _sectionFor(tab) == s ? _editAction(s, edit) : null;
    String date(String k) => c[k] == null ? '—' : fmtDate(c[k]);
    switch (tab) {
      case 'Address':
        return _list(
          context,
          rows: d.addresses,
          addLabel: '+ Add address',
          canAdd: _canEdit,
          empty: 'No addresses added yet${_canEdit ? ' — use “+ Add address” to add the registered office and plant addresses.' : '.'}',
          onAdd: () async {
            if (await editCompanyAddress(context, null)) reload();
          },
          item: (a) => _Item(
            title: str(a['address_type']).isEmpty ? 'Address' : str(a['address_type']),
            badges: [
              if (a['is_primary'] == true) const StatusBadge('Primary', color: _green),
              if (a['is_active'] != true) const StatusBadge('Inactive', color: _red),
            ],
            body: [a['address_line1'], a['address_line2'], a['landmark'], a['city'], a['district'], a['state'], a['country'], a['pincode']]
                .map(str)
                .where((s) => s.isNotEmpty)
                .join(', '),
            onEdit: _canEdit
                ? () async {
                    if (await editCompanyAddress(context, a)) reload();
                  }
                : null,
            onDelete: _canEdit
                ? () => _delete(context, 'Delete this address?',
                    'Delete the "${str(a['address_type']).isEmpty ? 'address' : a['address_type']}" record? This cannot be undone.',
                    '/organization/company/addresses/${a['id']}', reload)
                : null,
          ),
        );
      case 'Legal & Registration':
        return [
          DetailSection('Legal entity', action: act(CompanySection.legal), children: [
            FieldRow('Legal entity type', c['legal_entity_type']),
            FieldRow('Legal status', c['legal_status']),
          ]),
          DetailSection('Registration numbers', children: [
            FieldRow('CIN', c['cin']),
            FieldRow('PAN', c['pan']),
            FieldRow('TAN', c['tan']),
            FieldRow('GSTIN', c['gstin']),
            FieldRow('Udyam registration no.', c['udyam_registration_no']),
            FieldRow('IEC', c['iec']),
            FieldRow('MSME registration no.', c['msme_registration_no']),
            FieldRow('PF registration no.', c['pf_registration_no']),
            FieldRow('ESIC registration no.', c['esic_registration_no']),
          ]),
          DetailSection('Other registration', children: [
            FieldRow('Registration type', c['other_registration_type']),
            FieldRow('Registration number', c['other_registration_number']),
            FieldRow('Registration date', date('other_registration_date')),
            FieldRow('Issuing authority', c['issuing_authority']),
            FieldRow('Expiry date', date('expiry_date')),
          ]),
          DetailSection('Representative & capital', children: [
            FieldRow('Legal representative', c['legal_representative']),
            FieldRow('Authorized capital', c['authorized_capital'] == null ? null : fmtMoney(c['authorized_capital'])),
            FieldRow('Paid-up capital', c['paid_up_capital'] == null ? null : fmtMoney(c['paid_up_capital'])),
          ]),
        ];
      case 'Tax Configuration':
        return [
          DetailSection('GST', action: act(CompanySection.tax), children: [
            FieldRow('GST registration type', c['gst_registration_type']),
            FieldRow('Tax registration status', c['tax_registration_status']),
            FieldRow('Tax effective date', date('tax_effective_date')),
            FieldRow('Default tax region', c['default_tax_region']),
            FieldRow('Tax deductibility', c['tax_deductibility']),
          ]),
          DetailSection('Deducted / collected at source', children: [
            FieldRow('TDS applicable', c['tds_applicable'] == true ? 'Yes' : 'No'),
            FieldRow('TCS applicable', c['tcs_applicable'] == true ? 'Yes' : 'No'),
          ]),
        ];
      case 'Partners':
        return [_partners(context, d, reload)];
      case 'Contacts':
        return _list(
          context,
          rows: d.contacts,
          addLabel: '+ Add contact',
          canAdd: _canEdit,
          empty:
              'No contacts added yet${_canEdit ? ' — use “+ Add contact” to add the people customers and vendors should reach.' : '.'}',
          onAdd: () async {
            if (await editCompanyContact(context, null)) reload();
          },
          item: (ct) => _Item(
            title: str(ct['contact_person']),
            sub: [ct['designation'], ct['department']].map(str).where((s) => s.isNotEmpty).join(', '),
            badges: [
              if (ct['is_primary'] == true) const StatusBadge('Primary', color: _green),
              if (ct['is_active'] != true) const StatusBadge('Inactive', color: _red),
            ],
            body: [ct['mobile'], ct['phone'], ct['email'], ct['alternate_email']]
                .map(str)
                .where((s) => s.isNotEmpty)
                .join(' · ')
                .let((s) => s.isEmpty ? '—' : s),
            onEdit: _canEdit
                ? () async {
                    if (await editCompanyContact(context, ct)) reload();
                  }
                : null,
            onDelete: _canEdit
                ? () => _delete(context, 'Delete this contact?', 'Delete "${ct['contact_person']}"? This cannot be undone.',
                    '/organization/company/contacts/${ct['id']}', reload)
                : null,
          ),
        );
      case 'Financial Year':
        final mayEdit = _feat('financial_years', 'edit');
        return _list(
          context,
          rows: d.financialYears,
          addLabel: '+ Add financial year',
          canAdd: mayEdit,
          empty:
              'No financial years added yet${mayEdit ? ' — use “+ Add financial year” to add the current year (e.g. FY 2026-27).' : '.'}',
          onAdd: () async {
            if (await editFinancialYear(context, null)) reload();
          },
          item: (fy) => _Item(
            title: str(fy['name']),
            sub: str(fy['fiscal_year_code']),
            badges: [StatusBadge(humanize(fy['status']), color: fy['status'] == 'open' ? _green : _red)],
            body: '${fmtDate(fy['start_date'])} → ${fmtDate(fy['end_date'])}'
                '${fy['lock_date'] != null ? ' · Locked up to ${fmtDate(fy['lock_date'])}' : ''}',
            onEdit: mayEdit
                ? () async {
                    if (await editFinancialYear(context, fy)) reload();
                  }
                : null,
            onDelete: mayEdit
                ? () => _delete(context, 'Delete this financial year?', 'Delete "${fy['name']}"? This cannot be undone.',
                    '/organization/company/financial-years/${fy['id']}', reload)
                : null,
          ),
        );
      case 'Branding':
        return [
          DetailSection('Logo & colours', action: act(CompanySection.branding), children: [
            FieldRow('Company logo', c['logo_url']),
            FieldRow('Primary brand colour', _swatch(c['primary_brand_color'])),
            FieldRow('Secondary brand colour', _swatch(c['secondary_brand_color'])),
            FieldRow('Accent colour', _swatch(c['accent_color'])),
          ]),
          DetailSection('Documents & email', children: [
            FieldRow('Company header', c['company_header']),
            FieldRow('Company footer', c['company_footer']),
            FieldRow('Watermark', c['watermark']),
            FieldRow('Email signature', c['email_signature']),
          ]),
        ];
      case 'Documents':
        final mayUpload = _feat('documents', 'create');
        final mayDelete = _feat('documents', 'delete');
        final mayOpen = _feat('documents', 'export');
        return _list(
          context,
          rows: d.documents,
          addLabel: '+ Add document',
          canAdd: mayUpload,
          empty:
              'No documents uploaded yet${mayUpload ? ' — use “+ Add document” to upload registration certificates and licences.' : '.'}',
          onAdd: () async {
            if (await uploadCompanyDocument(context)) reload();
          },
          item: (doc) => _Item(
            title: str(doc['document_name']),
            sub: str(doc['document_type']),
            badges: [if (str(doc['confidentiality']).isNotEmpty) StatusBadge(doc['confidentiality'], color: _grey)],
            body: [
              str(doc['filename']),
              if (doc['expiry_date'] != null) 'Expires ${fmtDate(doc['expiry_date'])}',
              str(doc['issuing_authority']),
            ].where((s) => s.isNotEmpty).join(' · '),
            onOpen: mayOpen
                ? () => runAction(
                    context,
                    () => Files.downloadAndOpen('/organization/company/documents/${doc['id']}/content',
                        str(doc['filename']).isEmpty ? '${doc['document_name']}' : str(doc['filename'])))
                : null,
            onDelete: mayDelete
                ? () => _delete(context, 'Delete this document?', 'Delete "${doc['document_name']}"? This cannot be undone.',
                    '/organization/company/documents/${doc['id']}', reload)
                : null,
          ),
        );
      case 'Defaults & Controls':
        final plantId = asInt(c['default_plant_id']);
        final storeId = asInt(c['default_warehouse_id']);
        return [
          DetailSection('Used when a form leaves these blank', action: act(CompanySection.defaults), children: [
            FieldRow('Default tax', c['default_tax']),
            FieldRow('Default plant', plantId == null ? null : (d.plantNames[plantId] ?? 'Plant #$plantId')),
            FieldRow('Default store', storeId == null ? null : (d.storeNames[storeId] ?? 'Store #$storeId')),
            FieldRow('Default cost center', c['default_cost_center']),
            FieldRow('Default profit center', c['default_profit_center']),
          ]),
        ];
      default: // Basic
        return [
          DetailSection('Basic information', action: act(CompanySection.basic), children: [
            FieldRow('Company name', c['name']),
            FieldRow('Legal name', c['legal_name']),
            FieldRow('Short name', c['short_name']),
            FieldRow('Code', c['code']),
            FieldRow('Company type', c['company_type']),
            FieldRow('Industry', c['industry']),
            FieldRow('Business nature', c['business_nature']),
            FieldRow('Website', c['website']),
            FieldRow('Date of incorporation', date('date_of_incorporation')),
          ]),
          DetailSection('Locale', children: [
            FieldRow('Country', c['country']),
            FieldRow('Default currency', c['currency']),
            FieldRow('Default language', c['default_language']),
            FieldRow('Time zone', c['timezone']),
          ]),
        ];
    }
  }

  Object? _swatch(Object? hex) {
    final s = str(hex);
    if (s.isEmpty) return null;
    final v = int.tryParse(s.replaceFirst('#', ''), radix: 16);
    return Row(children: [
      Container(
        width: 16,
        height: 16,
        decoration: BoxDecoration(
          color: v == null ? Colors.transparent : Color(0xFF000000 | v),
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: Brand.border),
        ),
      ),
      const SizedBox(width: 8),
      Text(s, style: const TextStyle(fontSize: 14, color: Brand.body)),
    ]);
  }

  List<Widget> _list(
    BuildContext context, {
    required List<Json> rows,
    required String addLabel,
    required bool canAdd,
    required String empty,
    required VoidCallback onAdd,
    required Widget Function(Json) item,
  }) {
    return [
      if (canAdd)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Align(
            alignment: Alignment.centerLeft,
            child: PillButton(addLabel.replaceFirst('+ ', ''), icon: Icons.add_rounded, onPressed: onAdd),
          ),
        ),
      if (rows.isEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Text(empty, style: const TextStyle(fontSize: 13, color: Brand.muted)),
        )
      else
        for (final r in rows) item(r),
    ];
  }

  Future<void> _delete(BuildContext context, String title, String message, String path, VoidCallback reload) async {
    final ok = await confirmDialog(context, title: title, message: message, confirmLabel: 'Delete', danger: true);
    if (!ok || !context.mounted) return;
    if (await runAction(context, () => Api.delete(path))) reload();
  }

  Widget _partners(BuildContext context, _InfoData d, VoidCallback reload) {
    final mayEdit = _feat('partners', 'edit');
    final partners = d.partners ?? const <Json>[];
    return DetailSection(
      'Partners',
      action: mayEdit
          ? TextButton(
              onPressed: () async {
                if (await editPartners(context, partners)) reload();
              },
              child: Text(partners.isEmpty ? '+ Add partners' : 'Manage partners'),
            )
          : null,
      children: [
        const Text(
          "Partners are the company's top approval level: final approvers on legacy purchase orders, escalation contacts "
          'for overdue PM milestones, and the default signatory on letters and certificates. Pick them from the users synced from Azure.',
          style: TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.4),
        ),
        const SizedBox(height: 10),
        if (d.partnersError != null)
          ErrorBanner(d.partnersError!)
        else if (partners.isEmpty)
          Text('No partners set yet${mayEdit ? ' — use “+ Add partners” to pick them from the user list.' : '.'}',
              style: const TextStyle(fontSize: 13, color: Brand.muted))
        else
          for (final p in partners)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: Brand.border))),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Flexible(
                      child: Text(str(p['name']),
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
                    ),
                    if (p['is_active'] == false) ...[
                      const SizedBox(width: 8),
                      const StatusBadge('Inactive', color: _red),
                    ],
                  ]),
                  Text([p['designation'], p['email']].map(str).where((s) => s.isNotEmpty).join(' · '),
                      style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ],
              ),
            ),
      ],
    );
  }
}

extension _Let on String {
  String let(String Function(String) f) => f(this);
}

/// One row of a list tab (portal OrgListItem): title, tags, body, actions.
class _Item extends StatelessWidget {
  const _Item({required this.title, this.sub, this.badges = const [], required this.body, this.onEdit, this.onDelete, this.onOpen});
  final String title;
  final String? sub;
  final List<Widget> badges;
  final String body;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 6, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(title, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: Brand.heading)),
                  ...badges,
                ],
              ),
              if (sub != null && sub!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(sub!, style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                ),
              Padding(
                padding: const EdgeInsets.only(top: 4, right: 8),
                child: Text(body.isEmpty ? '—' : body, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              ),
              if (onEdit != null || onDelete != null || onOpen != null)
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (onOpen != null) TextButton(onPressed: onOpen, child: const Text('Open')),
                    if (onEdit != null) TextButton(onPressed: onEdit, child: const Text('Edit')),
                    if (onDelete != null)
                      TextButton(
                        style: TextButton.styleFrom(foregroundColor: Brand.danger),
                        onPressed: onDelete,
                        child: const Text('Delete'),
                      ),
                  ],
                )
              else
                const SizedBox(height: 6),
            ],
          ),
        ),
      ),
    );
  }
}
