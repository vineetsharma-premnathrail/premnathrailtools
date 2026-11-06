import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';
import 'crm_inquiry_detail.dart';
import 'crm_inquiry_forms.dart';
import 'crm_record_tabs.dart';

String _scopeLabel(Object? v) => v == 'international' ? 'International' : 'Domestic';

/// CRM › Customer Organizations list (organizations/page.tsx).
class OrganizationsTab extends StatefulWidget {
  const OrganizationsTab({super.key});

  @override
  State<OrganizationsTab> createState() => _OrganizationsTabState();
}

class _OrganizationsTabState extends State<OrganizationsTab> {
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _all = const [];
  String? _loadedFor;
  final Map<String, String> _f = {'org_scope': '', 'org_type': '', 'railway_zone': '', 'city': '', 'state': '', 'created_by_name': ''};
  String _sort = 'created_desc';
  List<Json> _dupGroups = const [];

  static const _filterLabels = {
    'org_scope': 'Scope',
    'org_type': 'Type',
    'railway_zone': 'Railway Zone',
    'city': 'City',
    'state': 'State',
    'created_by_name': 'Created By',
  };

  @override
  void initState() {
    super.initState();
    if (Perm.isAdmin) {
      Api.get('/crm/organizations/duplicates').then((d) {
        if (mounted && d is Map) setState(() => _dupGroups = jsonList(d['groups']));
      }).catchError((_) {});
    }
  }

  Future<ApiPage> _load(int page, String search) async {
    if (_loadedFor != search) {
      final rows = (await Api.list('/crm/organizations', query: {'search': search, 'limit': 10000})).rows;
      if (mounted) {
        setState(() {
          _all = rows;
          _loadedFor = search;
        });
      }
    }
    return ApiPage(_visible());
  }

  bool _ok(Json o, {bool skipScope = false}) => _f.entries.every((e) {
        if (e.value.isEmpty || (skipScope && e.key == 'org_scope')) return true;
        final v = e.key == 'org_scope' ? (o['org_scope'] == 'international' ? 'international' : 'domestic') : str(o[e.key]);
        return v == e.value;
      });

  List<Json> _visible() {
    final rows = _all.where(_ok).toList();
    rows.sort((a, b) => switch (_sort) {
          'name_asc' => str(a['name']).toLowerCase().compareTo(str(b['name']).toLowerCase()),
          'name_desc' => str(b['name']).toLowerCase().compareTo(str(a['name']).toLowerCase()),
          'created_asc' => str(a['created_at']).compareTo(str(b['created_at'])),
          _ => str(b['created_at']).compareTo(str(a['created_at'])),
        });
    return rows;
  }

  void _refilter() {
    setState(() {});
    _list.currentState?.reload();
  }

  void _reloadAll() {
    _loadedFor = null;
    _list.currentState?.reload();
  }

  Future<void> _filters() async {
    final draft = Map<String, String>.from(_f);
    var sort = _sort;
    List<String> values(String k) {
      final s = _all
          .map((o) => k == 'org_scope' ? (o['org_scope'] == 'international' ? 'international' : 'domestic') : str(o[k]))
          .where((v) => v.isNotEmpty)
          .toSet()
          .toList()
        ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
      return s;
    }

    final ok = await showFormSheet(
      context,
      title: 'Filter',
      saveLabel: 'Apply',
      builder: (ctx, setS) => [
        for (final k in _filterLabels.keys)
          AppSelect<String>(
            label: _filterLabels[k]!,
            value: draft[k]!.isEmpty ? null : draft[k],
            options: opts(values(k), label: k == 'org_scope' ? _scopeLabel : null),
            onChanged: (o) => setS(() => draft[k] = o?.value ?? ''),
          ),
        AppSelect<String>(
          label: 'Sort',
          value: sort,
          clearable: false,
          options: const [
            Option('created_desc', 'Created Date (New)'),
            Option('created_asc', 'Created Date (Old)'),
            Option('name_asc', 'Name (A–Z)'),
            Option('name_desc', 'Name (Z–A)'),
          ],
          onChanged: (o) => setS(() => sort = o?.value ?? sort),
        ),
      ],
      onSave: () async {},
    );
    if (!ok) return;
    _f.addAll(draft);
    _sort = sort;
    _refilter();
  }

  void _openOrg(int id) => openScreen(context, OrganizationScreen(id: id, onChanged: _reloadAll));

  Future<void> _create() async {
    final saved = await showOrganizationForm(context);
    if (saved == null || !mounted) return;
    _reloadAll();
    final id = asInt(saved['id']);
    if (id != null) _openOrg(id);
  }

  @override
  Widget build(BuildContext context) {
    final base = _all.where((o) => _ok(o, skipScope: true)).toList();
    final dom = base.where((o) => o['org_scope'] != 'international').length;
    final filtersOn = _f.entries.any((e) => e.key != 'org_scope' && e.value.isNotEmpty);
    final header = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        height: 44,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
          CountChip('Organizations', base.length, color: const Color(0xFF3B82F6), selected: _f['org_scope']!.isEmpty, onTap: () {
            _f['org_scope'] = '';
            _refilter();
          }),
          CountChip('Domestic', dom, color: const Color(0xFF16A34A), selected: _f['org_scope'] == 'domestic', onTap: () {
            _f['org_scope'] = _f['org_scope'] == 'domestic' ? '' : 'domestic';
            _refilter();
          }),
          CountChip('International', base.length - dom, color: const Color(0xFFEA580C), selected: _f['org_scope'] == 'international', onTap: () {
            _f['org_scope'] = _f['org_scope'] == 'international' ? '' : 'international';
            _refilter();
          }),
        ]),
      ),
      if (Perm.isAdmin && _dupGroups.isNotEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
          child: InkWell(
            onTap: () => openScreen(context, _DuplicatesScreen(groups: _dupGroups, onOpen: _openOrg)),
            child: InfoBox.warn('⚠ ${_dupGroups.length} duplicate customer organization ${_dupGroups.length == 1 ? 'name' : 'names'} found — review'),
          ),
        ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: Row(children: [
          Expanded(
              child: Text('${_visible().length} records${filtersOn ? ' · filtered' : ''}', style: const TextStyle(color: Brand.muted, fontSize: 13))),
          if (filtersOn || _f['org_scope']!.isNotEmpty)
            TextButton(
                onPressed: () {
                  for (final k in _f.keys) {
                    _f[k] = '';
                  }
                  _refilter();
                },
                child: const Text('Clear')),
          OutlinedButton.icon(onPressed: _filters, icon: const Icon(Icons.filter_list_rounded, size: 18), label: const Text('Filter')),
        ]),
      ),
    ]);
    return Scaffold(
      backgroundColor: Brand.background,
      floatingActionButton: CrmPerm.can('organizations', 'create') ? CreateFab(label: 'Add Customer Organization', onPressed: _create) : null,
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const PageHeader('Customer Organizations'),
        Expanded(
          child: ApiListView(
            key: _list,
            searchHint: 'Search name, type, zone, city, state...',
            header: header,
            emptyText: 'No customer organizations found.',
            load: _load,
            itemBuilder: (ctx, o, reload) => RecordCard(
              code: str(o['org_code']).isEmpty ? '—' : str(o['org_code']),
              title: str(o['name']),
              subtitle: joinNonEmpty([o['org_type'], o['railway_zone']], ' · '),
              trailing: Padding(padding: const EdgeInsets.only(left: 8), child: pill(_scopeLabel(o['org_scope']), Brand.muted)),
              meta: [
                ('City', txt(o['city'])),
                ('Created Date', fmtDate(o['created_at'])),
                ('Created By', txt(o['created_by_name'])),
              ],
              onTap: () => _openOrg(asInt(o['id'])!),
            ),
          ),
        ),
      ]),
    );
  }
}

class _DuplicatesScreen extends StatelessWidget {
  const _DuplicatesScreen({required this.groups, required this.onOpen});
  final List<Json> groups;
  final void Function(int id) onOpen;

  @override
  Widget build(BuildContext context) => SubPage(
        title: 'Duplicate Customer Organizations',
        body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          const Note(
              "These customer organizations share the same name. Nothing has been changed automatically — review each group and merge/delete manually via each customer organization's detail page once you've confirmed which one to keep.",
              padding: EdgeInsets.fromLTRB(16, 0, 16, 12)),
          for (final g in groups)
            DetailSection(str(g['name']), children: [
              for (final o in jsonList(g['organizations']))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('#${o['id']} · ${str(o['org_code']).isEmpty ? 'no code' : o['org_code']} · ${txt(o['city'])}, ${txt(o['state'])}'
                      '${str(o['gst_number']).isEmpty ? '' : ' · GST ${o['gst_number']}'}'),
                  subtitle: Text('${o['inquiry_count'] ?? 0} inquiries · ${o['tender_count'] ?? 0} tenders'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () {
                    Navigator.pop(context);
                    onOpen(asInt(o['id'])!);
                  },
                ),
            ]),
        ]),
      );
}

/// Customer organization detail (OrganizationDetailPanel.tsx).
class OrganizationScreen extends StatefulWidget {
  const OrganizationScreen({super.key, required this.id, this.onChanged});
  final int id;
  final VoidCallback? onChanged;

  @override
  State<OrganizationScreen> createState() => _OrganizationScreenState();
}

class _OrganizationScreenState extends State<OrganizationScreen> {
  Json? _org;
  Object? _error;
  String _tab = 'Overview';
  List<Json> _inquiries = const [];
  List<Json> _tenders = const [];
  List<Json> _audit = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final o = await Api.get('/crm/organizations/${widget.id}/detail');
      if (mounted) {
        setState(() {
          _org = Map<String, dynamic>.from(o as Map);
          _error = null;
        });
      }
      _loadLinked();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _loadLinked() async {
    try {
      final r = await Future.wait([
        Api.list('/crm/inquiries', query: {'org_id': widget.id, 'limit': 10000}),
        Api.list('/crm/tenders', query: {'org_id': widget.id, 'limit': 10000}),
      ]);
      if (mounted) {
        setState(() {
          _inquiries = r[0].rows;
          _tenders = r[1].rows;
        });
      }
    } catch (_) {}
    if (CrmPerm.feat('organizations', 'audit_trail', 'view')) {
      try {
        final a = (await Api.list('/crm/organizations/${widget.id}/audit')).rows;
        if (mounted) setState(() => _audit = a);
      } catch (_) {}
    }
  }

  void _changed() {
    widget.onChanged?.call();
    _load();
  }

  bool get _ownerOrAdmin => CrmPerm.ownerOrAdmin(_org?['created_by_id']);
  bool get _canModify => _ownerOrAdmin && CrmPerm.can('organizations', 'edit');

  List<String> get _tabs => [
        'Overview',
        if (CrmPerm.feat('organizations', 'contacts', 'view')) 'Contacts',
        if (CrmPerm.feat('organizations', 'linked_records', 'view')) ...['Inquiries', 'Tenders'],
        if (CrmPerm.feat('organizations', 'audit_trail', 'view')) 'Audit Trail',
      ];

  Future<void> _delete() async {
    final yes = await confirmDialog(context,
        title: 'Delete this customer organization?',
        message: 'Delete customer organization ${str(_org!['name'])}? Its inquiries and tenders will also be deleted. This action cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    if (await crmRun(context, () => Api.delete('/crm/organizations/${widget.id}'), success: 'Customer organization deleted.')) {
      widget.onChanged?.call();
      if (mounted) Navigator.pop(context);
    }
  }

  Future<void> _addRecord(CrmKind kind) async {
    final saved = kind == CrmKind.inquiry
        ? await showInquiryForm(context, defaultOrgId: widget.id, defaultOrgName: str(_org?['name']))
        : await showTenderForm(context, defaultOrgId: widget.id, defaultOrgName: str(_org?['name']));
    if (saved == null || !mounted) return;
    _changed();
    final id = asInt(saved['id']);
    if (id != null) openCrmRecord(context, kind, id, onChanged: _changed);
  }

  @override
  Widget build(BuildContext context) {
    final o = _org;
    if (o == null) {
      return SubPage(title: 'Customer Organization', body: _error != null ? ErrorView(crmError(_error!), onRetry: _load) : const LoadingView());
    }
    final tabs = _tabs;
    if (!tabs.contains(_tab)) _tab = 'Overview';
    String tabLabel(String t) => switch (t) {
          'Contacts' => 'Contacts ${jsonList(o['contacts']).length}',
          'Inquiries' => 'Inquiries ${o['inquiry_count'] ?? _inquiries.length}',
          'Tenders' => 'Tenders ${o['tender_count'] ?? _tenders.length}',
          _ => t,
        };
    final buttons = <Widget>[
      if (CrmPerm.canDelete('organizations', o['created_by_id'])) dangerBtn('Delete', _delete),
      if (_canModify)
        primaryBtn('Edit', () async {
          if (await showOrganizationForm(context, initial: o) != null) _changed();
        }),
    ];
    return SubPage(
      title: str(o['name']),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Caps('${str(o['org_type']).isEmpty ? 'Customer Organization' : str(o['org_type'])}${str(o['org_code']).isEmpty ? '' : ' · ${o['org_code']}'}'),
              const SizedBox(height: 2),
              Text(str(o['name']), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: Brand.heading)),
            ]),
          ),
          SubTabs(tabs: tabs.map(tabLabel).toList(), index: tabs.indexOf(_tab), onChanged: (i) => setState(() => _tab = tabs[i])),
          const SizedBox(height: 8),
          ..._body(o),
        ]),
      ),
      bottom: buttons.isEmpty ? null : actionBar(buttons),
    );
  }

  List<Widget> _body(Json o) {
    switch (_tab) {
      case 'Contacts':
        return _contacts(o);
      case 'Inquiries':
        return [
          if (CrmPerm.can('inquiries_tenders', 'create')) tabButtons([primaryBtn('+ Add Inquiry', () => _addRecord(CrmKind.inquiry))]),
          if (_inquiries.isEmpty) const EmptyView('No inquiries for this customer organization yet.'),
          for (final i in _inquiries)
            RecordCard(
              code: str(i['universal_id']),
              title: str(i['product']).isEmpty ? 'Not provided' : str(i['product']),
              trailing: Padding(padding: const EdgeInsets.only(left: 8), child: pill(i['status'], CrmLists.inquiryColor(i['status']))),
              meta: [
                ('Contact Person', txt(jsonList(o['contacts']).where((c) => c['id'] == i['org_contact_id']).firstOrNull?['name'])),
                ('Priority', CrmLists.normalizePriority(i['priority']) == 'urgent' ? 'Urgent' : 'Standard'),
                ('Follow-up', fmtDate(i['next_followup_date'])),
              ],
              onTap: () => openCrmRecord(context, CrmKind.inquiry, asInt(i['id'])!, onChanged: _changed),
            ),
        ];
      case 'Tenders':
        return [
          if (CrmPerm.can('inquiries_tenders', 'create')) tabButtons([primaryBtn('+ Add Tender', () => _addRecord(CrmKind.tender))]),
          if (_tenders.isEmpty) const EmptyView('No tenders for this customer organization yet.'),
          for (final t in _tenders)
            RecordCard(
              code: str(t['universal_id']),
              title: str(t['tender_name']).isEmpty ? (str(t['tender_number']).isEmpty ? '—' : str(t['tender_number'])) : str(t['tender_name']),
              subtitle: str(t['tender_number']),
              trailing: Padding(padding: const EdgeInsets.only(left: 8), child: pill(t['status'], CrmLists.tenderColor(t['status']))),
              meta: [
                ('Stage', txt(t['current_stage'])),
                ('Submission', fmtDate(t['submission_date'])),
                if (CrmPerm.it('prices', 'view') && t['tender_value'] != null) ('Value', '${str(t['currency'])} ${fmtNumber(t['tender_value'])}'),
              ],
              onTap: () => openCrmRecord(context, CrmKind.tender, asInt(t['id'])!, onChanged: _changed),
            ),
        ];
      case 'Audit Trail':
        return [
          if (_audit.isEmpty) const EmptyView('No audit history yet.'),
          for (final a in _audit)
            RecordCard(
              title: str(a['summary']).isEmpty ? humanize(a['action']) : str(a['summary']),
              status: a['action'],
              subtitle: '${txt(a['performed_by'])} · ${fmtDateTime(a['performed_at'])}',
            ),
        ];
    }
    final intl = o['org_scope'] == 'international';
    final railway = CrmLists.hasRailwayFields(str(o['org_type'])) || str(o['railway_zone']).isNotEmpty || str(o['division_workshop']).isNotEmpty;
    Widget r(String l, Object? v) => row(l, v, empty: 'Not added');
    return [
      DetailSection(str(o['name']), children: [
        Note(joinNonEmpty([
          'Code: ${str(o['org_code']).isEmpty ? '—' : o['org_code']}',
          if (o['created_at'] != null) 'Added ${fmtDate(o['created_at'])}${str(o['created_by_name']).isEmpty ? '' : ' by ${o['created_by_name']}'}',
        ], ' · ')),
      ]),
      DetailSection('Customer Organization Details', children: [
        r('Scope', _scopeLabel(o['org_scope'])),
        r('Type', o['org_type']),
        if (railway) r('Railway zone', o['railway_zone']),
        if (railway) r('Division / Workshop', o['division_workshop']),
      ]),
      DetailSection('Address', children: [
        r('Address', o['address']),
        r('City / State', joinNonEmpty([o['city'], o['state']])),
        r(intl ? 'ZIP / Postal code' : 'PIN code', o['pin_code']),
        r('Country', o['country']),
      ]),
      DetailSection('Contact & Registration', children: [
        r('Official phone', joinNonEmpty([o['official_phone'], ...strList(o['additional_phones'])])),
        r('Official email', joinNonEmpty([o['official_email'], ...strList(o['additional_emails'])])),
        r('Website', o['website']),
        if (intl) ...[
          r('Tax / VAT ID', o['tax_vat_id']),
          r('Company registration number', o['company_registration_no']),
        ] else ...[
          r('GSTIN', o['gst_number']),
          r('PAN', o['pan']),
          r('GST state code (place of supply)', o['gst_state_code']),
        ],
      ]),
    ];
  }

  List<Widget> _contacts(Json o) {
    final contacts = jsonList(o['contacts']);
    final canCreate = CrmPerm.feat('organizations', 'contacts', 'create');
    final canEdit = _ownerOrAdmin && CrmPerm.feat('organizations', 'contacts', 'edit');
    return [
      if (canCreate)
        tabButtons([
          primaryBtn('+ Add Contact', () async {
            if (await showContactForm(context, o)) _changed();
          }),
        ]),
      if (contacts.isEmpty) EmptyView('No contacts added yet${canCreate ? ' — use + Add Contact.' : '.'}'),
      for (final c in contacts)
        RecordCard(
          title: str(c['name']),
          subtitle: joinNonEmpty([
            joinNonEmpty([c['designation'], c['department']], ' · '),
            joinNonEmpty([c['mobile'], ...strList(c['additional_mobiles'])]),
            joinNonEmpty([c['email'], ...strList(c['additional_emails'])]),
          ], '\n'),
          meta: [
            for (final i in _inquiries.where((i) => i['org_contact_id'] == c['id'])) ('Inquiry', str(i['universal_id'])),
            for (final t in _tenders.where((t) => t['org_contact_id'] == c['id'])) ('Tender', str(t['universal_id'])),
          ],
          trailing: canEdit
              ? IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined, color: Brand.primary),
                  onPressed: () async {
                    if (await showContactForm(context, o, contact: c)) _changed();
                  })
              : null,
        ),
    ];
  }
}

/// Add / edit a contact person (OrganizationDetailPanel ContactsTab form). True when saved.
Future<bool> showContactForm(BuildContext context, Json org, {Json? contact}) async {
  final orgId = asInt(org['id'])!;
  final others = jsonList(org['contacts']).where((c) => contact == null || c['id'] != contact['id']).toList();
  final name = TextEditingController(text: str(contact?['name']));
  var (desig, desigOther0) = splitOther(contact?['designation'], CrmLists.designations);
  var (dept, deptOther0) = splitOther(contact?['department'], CrmLists.departments);
  final desigOther = TextEditingController(text: desigOther0);
  final deptOther = TextEditingController(text: deptOther0);
  final phones = MultiValues(str(contact?['mobile']), strList(contact?['additional_mobiles']));
  final emails = MultiValues(str(contact?['email']), strList(contact?['additional_emails']));
  final emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
  var dupNameConfirmed = false;
  return showFormSheet(
    context,
    title: contact == null ? 'Add Contact' : 'Edit Contact',
    saveLabel: contact == null ? 'Save Contact' : 'Save Changes',
    builder: (ctx, setS) {
      final dupMobile = phones.first.isNotEmpty && others.any((c) => str(c['mobile']).trim() == phones.first);
      final dupEmail = emails.first.isNotEmpty && others.any((c) => str(c['email']).trim().toLowerCase() == emails.first.toLowerCase());
      return [
        Note('Contact person at ${str(org['name'])}.'),
        const FormSection('Person'),
        AppTextField(label: 'Name', required: true, controller: name),
        SelectWithOther(
            label: 'Designation',
            options: CrmLists.designations,
            value: desig,
            other: desigOther,
            otherHint: 'Type designation, e.g. DEN',
            onChanged: (v) => setS(() => desig = v)),
        SelectWithOther(
            label: 'Department',
            options: CrmLists.departments,
            value: dept,
            other: deptOther,
            otherHint: 'Type department, e.g. Stores',
            onChanged: (v) => setS(() => dept = v)),
        const FormSection('Reach'),
        MultiValueField(label: 'Phone', values: phones, setState: setS, keyboardType: TextInputType.phone, addTooltip: 'Add another phone'),
        if (dupMobile) const Note('Already used by another contact on this customer organization.', color: Brand.danger),
        MultiValueField(label: 'Email', values: emails, setState: setS, keyboardType: TextInputType.emailAddress, addTooltip: 'Add another email'),
        if (dupEmail) const Note('Already used by another contact on this customer organization.', color: Brand.danger),
      ];
    },
    onSave: () async {
      if (name.text.trim().isEmpty) throw "Enter the contact person's name — it is required.";
      if (emails.first.isNotEmpty && !emailRe.hasMatch(emails.first)) throw 'Enter a valid email address for this contact.';
      final bad = emails.rest.where((e) => !emailRe.hasMatch(e)).firstOrNull;
      if (bad != null) throw 'Enter a valid email address — "$bad" isn\'t one. Fix it or remove that row.';
      if ((phones.rest.isNotEmpty && phones.first.isEmpty) || (emails.rest.isNotEmpty && emails.first.isEmpty)) {
        throw 'Fill in the main Phone / Email first — the extra rows are for a second or third number/address.';
      }
      final errs = [
        if (phones.first.isNotEmpty && others.any((c) => str(c['mobile']).trim() == phones.first))
          'This phone number is already used by another contact on this customer organization.',
        if (emails.first.isNotEmpty && others.any((c) => str(c['email']).trim().toLowerCase() == emails.first.toLowerCase()))
          'This email address is already used by another contact on this customer organization.',
      ];
      if (errs.isNotEmpty) throw errs.join('\n');
      if (!dupNameConfirmed && others.any((c) => str(c['name']).trim().toLowerCase() == name.text.trim().toLowerCase())) {
        final yes = await confirmDialog(context,
            title: 'Possible duplicate contact',
            message: 'A contact with the same name, phone, or email already exists for this customer organization. Save anyway?',
            confirmLabel: 'Save anyway');
        if (!yes) throw 'Not saved — a contact with this name already exists.';
        dupNameConfirmed = true;
      }
      final body = {
        'name': name.text.trim(),
        'designation': desig == 'Other' ? desigOther.text.trim() : desig,
        'department': dept == 'Other' ? deptOther.text.trim() : dept,
        'mobile': phones.first,
        'email': emails.first,
        'additional_mobiles': phones.rest,
        'additional_emails': emails.rest,
      };
      await guard(() => contact == null
          ? Api.post('/crm/organizations/$orgId/contacts', data: body)
          : Api.patch('/crm/organizations/$orgId/contacts/${contact['id']}', data: body));
    },
  );
}

class _NewContact {
  final name = TextEditingController();
  String desig = '';
  String dept = '';
  final desigOther = TextEditingController();
  final deptOther = TextEditingController();
  final phones = MultiValues('', const []);
  final emails = MultiValues('', const []);
}

final _gstRe = RegExp(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
final _panRe = RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$');
final _taxRe = RegExp(r'^[A-Za-z0-9 .\-/]{2,50}$');
final _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

/// Create / edit customer organization (OrganizationForm.tsx). Returns the saved organization.
Future<Json?> showOrganizationForm(BuildContext context, {Json? initial}) async {
  final isEdit = initial != null;
  var scope = isEdit ? (initial['org_scope'] == 'international' ? 'international' : 'domestic') : '';
  final types0 = scope.isEmpty ? [...CrmLists.orgTypesDomestic, ...CrmLists.orgTypesInternational] : CrmLists.orgTypesFor(scope);
  var (orgType, orgTypeOther0) = splitOther(initial?['org_type'], types0);
  final orgTypeOther = TextEditingController(text: orgTypeOther0);
  final name = TextEditingController(text: str(initial?['name']));
  var (zone, zoneOther0) = splitOther(initial?['railway_zone'], CrmLists.railwayZones);
  final zoneOther = TextEditingController(text: zoneOther0);
  final division = TextEditingController(text: str(initial?['division_workshop']));
  final gst = TextEditingController(text: str(initial?['gst_number']));
  final pan = TextEditingController(text: str(initial?['pan']));
  final tax = TextEditingController(text: str(initial?['tax_vat_id']));
  final reg = TextEditingController(text: str(initial?['company_registration_no']));
  final address = TextEditingController(text: str(initial?['address']));
  var (country, countryOther0) = splitOther(initial?['country'] ?? (scope == 'domestic' ? 'India' : null), CrmLists.countries);
  final countryOther = TextEditingController(text: countryOther0);
  var stateSel = str(initial?['state']);
  final stateText = TextEditingController(text: str(initial?['state']));
  final city = TextEditingController(text: str(initial?['city']));
  final pin = TextEditingController(text: str(initial?['pin_code']));
  final phones = MultiValues(str(initial?['official_phone']), strList(initial?['additional_phones']));
  final emails = MultiValues(str(initial?['official_email']), strList(initial?['additional_emails']));
  final website = TextEditingController(text: str(initial?['website']));
  final contacts = <_NewContact>[if (!isEdit) _NewContact()];
  String? nameWarning;
  Json? saved;

  Future<void> checkName(StateSetter setS) async {
    final q = name.text.trim();
    if (q.length < 3) return;
    try {
      final r = await Api.get('/crm/organizations/search-name', query: {'q': q});
      final hits = (r is List ? jsonList(r) : jsonList(r is Map ? (r['matches'] ?? r['items']) : null))
          .where((o) => !isEdit || o['id'] != initial['id'])
          .toList();
      setS(() => nameWarning = hits.isEmpty
          ? null
          : 'A customer organization with a similar name already exists: ${hits.take(3).map((o) => str(o['name'])).join(', ')}. Make sure you are not adding a duplicate.');
    } catch (_) {}
  }

  final ok = await showFormSheet(
    context,
    title: isEdit ? 'Edit ${str(initial['name'])}' : 'Add Customer Organization',
    saveLabel: isEdit ? 'Save Changes' : 'Create Customer Organization',
    builder: (ctx, setS) {
      final domestic = scope == 'domestic';
      final intl = scope == 'international';
      return [
        Note(isEdit
            ? 'Change the customer record. Contact persons are kept on the Contacts tab.'
            : 'A customer, railway unit or partner we deal with, with its contact persons.'),
        const FormSection('Customer Organization Details'),
        AppSelect<String>(
          label: 'Organization Scope',
          required: true,
          value: scope.isEmpty ? null : scope,
          options: const [Option('domestic', 'Domestic'), Option('international', 'International')],
          onChanged: (o) async {
            final v = o?.value;
            if (v == null || v == scope) return;
            final hasData = v == 'international' ? (gst.text.isNotEmpty || pan.text.isNotEmpty) : (tax.text.isNotEmpty || reg.text.isNotEmpty);
            if (hasData) {
              final yes = await confirmDialog(ctx,
                  title: 'Switch to ${v == 'international' ? 'International' : 'Domestic'}?',
                  message: v == 'international'
                      ? 'Switching to International clears GSTIN and PAN. Continue?'
                      : 'Switching to Domestic clears Tax / VAT ID and Company Registration Number. Continue?',
                  confirmLabel: 'Switch and clear');
              if (!yes) return;
            }
            setS(() {
              scope = v;
              if (v == 'international') {
                gst.clear();
                pan.clear();
                if (country == 'India') country = '';
              } else {
                tax.clear();
                reg.clear();
                country = 'India';
              }
              if (!CrmLists.orgTypesFor(v).contains(orgType)) orgType = '';
            });
          },
        ),
        if (scope.isEmpty) const Note('Choose Domestic or International first. The fields below unlock once you do.'),
        if (scope.isNotEmpty) ...[
          AppSelect<String>(
            label: 'Customer Organization Type',
            required: true,
            value: orgType.isEmpty ? null : orgType,
            options: opts(CrmLists.orgTypesFor(scope), label: CrmLists.orgTypeLabel),
            onChanged: (o) => setS(() => orgType = o?.value ?? ''),
          ),
          if (orgType == 'Other') AppTextField(label: 'Specify customer organization type', controller: orgTypeOther),
          Focus(
            onFocusChange: (f) {
              if (!f) checkName(setS);
            },
            child: AppTextField(label: 'Customer Organization Name', required: true, controller: name, hint: 'e.g. Northern Railway HQ'),
          ),
          if (nameWarning != null) InfoBox.warn(nameWarning!),
          if (CrmLists.hasRailwayFields(orgType)) ...[
            SelectWithOther(
                label: 'Railway Zone',
                options: CrmLists.railwayZones,
                value: zone,
                other: zoneOther,
                otherHint: 'Specify railway zone',
                onChanged: (v) => setS(() => zone = v)),
            AppTextField(label: 'Division / Workshop', controller: division, hint: 'e.g. Agra Division'),
          ],
          if (domestic) ...[
            AppTextField(label: 'GSTIN', controller: gst, hint: '15 characters, e.g. 07AABCU9603R1ZW'),
            AppTextField(label: 'PAN', controller: pan, hint: '10 characters, from GSTIN'),
          ],
          if (intl) ...[
            AppTextField(label: 'Tax / VAT ID', controller: tax, hint: 'e.g. GB123456789'),
            AppTextField(label: 'Company Registration Number', controller: reg, hint: 'e.g. 01234567'),
          ],
          const FormSection('Address'),
          AppTextField(label: 'Address', controller: address, maxLines: 2, hint: 'Street / locality'),
          AppSelect<String>(
            label: 'Country',
            required: intl,
            enabled: !domestic,
            value: country.isEmpty ? null : country,
            options: opts(CrmLists.countries.where((c) => domestic || c != 'India')),
            onChanged: (o) => setS(() {
              country = o?.value ?? '';
              stateSel = '';
              stateText.clear();
            }),
          ),
          if (country == 'Other') AppTextField(label: 'Specify country', controller: countryOther),
          if (country == 'India')
            AppSelect<String>(
                label: 'State / UT',
                value: stateSel.isEmpty ? null : stateSel,
                options: opts(keepCurrent(CrmLists.indiaStates, stateSel)),
                onChanged: (o) => setS(() => stateSel = o?.value ?? ''))
          else
            AppTextField(label: 'State / Province', controller: stateText, hint: 'e.g. Dubai'),
          AppTextField(label: 'City', controller: city, hint: 'e.g. New Delhi'),
          AppTextField(
              label: intl ? 'ZIP / Postal Code' : 'PIN Code',
              controller: pin,
              keyboardType: intl ? null : TextInputType.number,
              hint: intl ? 'e.g. 10001' : '110001'),
          const FormSection('Contact & Registration'),
          MultiValueField(label: 'Official Phone', values: phones, setState: setS, keyboardType: TextInputType.phone, addTooltip: 'Add another phone'),
          MultiValueField(
              label: 'Official Email', values: emails, setState: setS, keyboardType: TextInputType.emailAddress, addTooltip: 'Add another email'),
          AppTextField(label: 'Website', controller: website, keyboardType: TextInputType.url, hint: 'https://'),
          if (!isEdit) ...[
            const FormSection('Contact Persons'),
            const Note('Add key contacts for this customer organization.'),
            for (var i = 0; i < contacts.length; i++)
              Container(
                key: ObjectKey(contacts[i]),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Expanded(child: AppTextField(label: 'Name', required: true, controller: contacts[i].name, hint: 'Contact name', onChanged: (_) => setS(() {}))),
                    if (contacts.length > 1)
                      rowIconButton(Icons.close_rounded, 'Remove', () => setS(() => contacts.removeAt(i)), color: Brand.danger),
                  ]),
                  const SizedBox(height: 10),
                  SelectWithOther(
                      label: 'Designation',
                      options: CrmLists.designations,
                      value: contacts[i].desig,
                      other: contacts[i].desigOther,
                      otherHint: 'Type designation, e.g. DEN',
                      onChanged: (v) => setS(() => contacts[i].desig = v)),
                  const SizedBox(height: 10),
                  SelectWithOther(
                      label: 'Department',
                      options: CrmLists.departments,
                      value: contacts[i].dept,
                      other: contacts[i].deptOther,
                      otherHint: 'Type department, e.g. Stores',
                      onChanged: (v) => setS(() => contacts[i].dept = v)),
                  const SizedBox(height: 10),
                  MultiValueField(label: 'Phone', values: contacts[i].phones, setState: setS, keyboardType: TextInputType.phone),
                  const SizedBox(height: 10),
                  MultiValueField(label: 'Email', values: contacts[i].emails, setState: setS, keyboardType: TextInputType.emailAddress),
                ]),
              ),
            Align(
              alignment: Alignment.centerLeft,
              child: secondaryBtn('Add Contact', contacts.every((c) => c.name.text.trim().isNotEmpty) ? () => setS(() => contacts.add(_NewContact())) : null,
                  icon: Icons.add_rounded),
            ),
          ],
        ],
      ];
    },
    onSave: () async {
      final errs = <String>[];
      if (scope.isEmpty) errs.add('Choose Domestic or International. This decides which tax details are asked.');
      if (orgType.isEmpty) {
        errs.add('Customer Organization Type is required. Pick one from the list.');
      } else if (orgType == 'Other' && orgTypeOther.text.trim().isEmpty) {
        errs.add('Please specify the customer organization type.');
      }
      if (name.text.trim().isEmpty) errs.add('Customer Organization name is required.');
      final g = gst.text.trim().toUpperCase();
      final p = pan.text.trim().toUpperCase();
      final countryValue = country == 'Other' ? countryOther.text.trim() : country;
      if (scope == 'domestic') {
        if (g.isNotEmpty && !_gstRe.hasMatch(g)) errs.add('GSTIN must be 15 characters in the standard format, e.g. 07AABCU9603R1ZW.');
        if (p.isNotEmpty && !_panRe.hasMatch(p)) errs.add('PAN must be 10 characters like AABCU9603R (5 letters, 4 digits, 1 letter).');
        if (g.isNotEmpty && _gstRe.hasMatch(g) && p.isNotEmpty && _panRe.hasMatch(p) && p != g.substring(2, 12)) {
          errs.add('PAN must match characters 3 to 12 of the GSTIN (${g.substring(2, 12)}). Correct it or clear it to fill from the GSTIN.');
        }
      }
      if (scope == 'international') {
        if (tax.text.trim().isNotEmpty && !_taxRe.hasMatch(tax.text.trim())) errs.add('Tax / VAT ID must be 2 to 50 characters: letters, digits, spaces, - . /');
        if (reg.text.trim().isNotEmpty && !_taxRe.hasMatch(reg.text.trim())) {
          errs.add('Company Registration Number must be 2 to 50 characters: letters, digits, spaces, - . /');
        }
        if (countryValue.isEmpty) {
          errs.add('Choose the country of this international organization.');
        } else if (countryValue.toLowerCase() == 'india') {
          errs.add('An international organization is outside India — pick its country, or switch Organization Scope to Domestic for an Indian organization.');
        }
      }
      if (emails.first.isNotEmpty && !_emailRe.hasMatch(emails.first)) errs.add('Please enter a valid official email before saving.');
      if (emails.rest.any((e) => !_emailRe.hasMatch(e))) errs.add('Please enter a valid additional email before saving.');
      final web = website.text.trim();
      if (web.isNotEmpty && !RegExp(r'^(https?://)?[\w-]+(\.[\w-]+)+([/?#].*)?$').hasMatch(web)) errs.add('Please enter a valid website address before saving.');
      final allPhones = [phones.first, ...phones.rest].where((x) => x.isNotEmpty).toList();
      final allEmails = [emails.first, ...emails.rest].map((e) => e.toLowerCase()).where((x) => x.isNotEmpty).toList();
      if (allPhones.toSet().length != allPhones.length || allEmails.toSet().length != allEmails.length) {
        errs.add('Remove the duplicate phone numbers / email addresses before saving.');
      }
      for (final c in contacts) {
        if ([c.emails.first, ...c.emails.rest].any((e) => e.isNotEmpty && !_emailRe.hasMatch(e))) {
          errs.add('Please enter a valid email for each contact before saving.');
          break;
        }
      }
      if (errs.isNotEmpty) throw errs.join('\n');

      final payload = <String, dynamic>{
        'org_scope': scope,
        'name': name.text.trim(),
        'org_type': orgType == 'Other' ? orgTypeOther.text.trim() : orgType,
        'railway_zone': CrmLists.hasRailwayFields(orgType) ? (zone == 'Other' ? zoneOther.text.trim() : zone) : str(initial?['railway_zone']),
        'division_workshop': CrmLists.hasRailwayFields(orgType) ? division.text.trim() : str(initial?['division_workshop']),
        'address': address.text.trim(),
        'country': scope == 'domestic' ? 'India' : countryValue,
        'state': country == 'India' ? stateSel : stateText.text.trim(),
        'city': city.text.trim(),
        'pin_code': pin.text.trim(),
        'official_phone': phones.first,
        'additional_phones': phones.rest,
        'official_email': emails.first,
        'additional_emails': emails.rest,
        'website': web,
      };
      if (scope == 'domestic') {
        payload['gst_number'] = g;
        payload['pan'] = p.isEmpty ? null : p;
      } else {
        payload['tax_vat_id'] = tax.text.trim().isEmpty ? null : tax.text.trim();
        payload['company_registration_no'] = reg.text.trim().isEmpty ? null : reg.text.trim();
      }
      payload.removeWhere((k, v) => v == '' && !isEdit);
      if (isEdit) payload.removeWhere((k, v) => v == '' && str(initial[k]).isEmpty);
      final r = await guard(() => isEdit ? Api.patch('/crm/organizations/${initial['id']}', data: payload) : Api.post('/crm/organizations', data: payload));
      saved = r is Map ? Map<String, dynamic>.from(r) : null;
      final orgId = asInt(saved?['id']);
      if (!isEdit && orgId != null) {
        final failed = <String>[];
        for (final c in contacts) {
          if (c.name.text.trim().isEmpty) continue;
          try {
            await Api.post('/crm/organizations/$orgId/contacts', data: {
              'name': c.name.text.trim(),
              if (c.desig.isNotEmpty) 'designation': c.desig == 'Other' ? c.desigOther.text.trim() : c.desig,
              if (c.dept.isNotEmpty) 'department': c.dept == 'Other' ? c.deptOther.text.trim() : c.dept,
              if (c.phones.first.isNotEmpty) 'mobile': c.phones.first,
              if (c.emails.first.isNotEmpty) 'email': c.emails.first,
              'additional_mobiles': c.phones.rest,
              'additional_emails': c.emails.rest,
            });
          } catch (e) {
            failed.add('${c.name.text.trim()}: ${crmError(e)}');
          }
        }
        if (failed.isNotEmpty && context.mounted) {
          showSnack(context, 'Customer Organization "${str(saved?['name'])}" was saved, but these contacts were not: ${failed.join('; ')}. Add them on the Contacts tab.',
              error: true);
        }
      }
    },
  );
  if (ok && context.mounted) showSnack(context, 'Customer Organization "${str(saved?['name'])}" saved successfully.');
  return ok ? saved : null;
}
