import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';
import 'requisitions.dart' show naturalCompare;

// Vendors (portal app/dashboard/p2p/vendors, vendors/[id], VendorFormDialog):
// the shared vendor master, its documents and catalog.

const _statusLabel = {'active': 'Active', 'inactive': 'Inactive', 'blocked': 'Blocked'};
const _statusHex = {'active': 0xFF16A34A, 'inactive': 0xFF78716C, 'blocked': 0xFFDC2626};

class VendorsTab extends StatefulWidget {
  const VendorsTab({super.key});

  @override
  State<VendorsTab> createState() => _VendorsTabState();
}

class _VendorsTabState extends State<VendorsTab> {
  final _key = GlobalKey<ApiListViewState>();
  List<Json>? _all;
  bool _useCache = false;
  String _status = 'active';
  String _search = '';
  ({int all, int active, int inactive, int blocked}) _c = (all: 0, active: 0, inactive: 0, blocked: 0);

  bool get _allowed =>
      P2pAccess.isAdmin || P2pAccess.can('vendors', 'view') || P2pAccess.apps.contains('purchase') || P2pAccess.apps.contains('accounts');

  Future<ApiPage> _load(int page, String search) async {
    if (_all == null || !_useCache) _all = asList(await Api.get('/p2p/vendors'));
    _useCache = false;
    _search = search;
    final q = search.toLowerCase();
    final searched = [..._all!]..sort((a, b) => naturalCompare(jStr(a, 'code') ?? '', jStr(b, 'code') ?? ''));
    final hit = searched
        .where((v) => q.isEmpty ||
            [v['name'], v['code'], v['gstin'], v['city'], v['contact_name'], v['contact_phone']].any((x) => (x ?? '').toString().toLowerCase().contains(q)))
        .toList();
    final c = (
      all: hit.length,
      active: hit.where((v) => jStr(v, 'status') == 'active').length,
      inactive: hit.where((v) => jStr(v, 'status') == 'inactive').length,
      blocked: hit.where((v) => jStr(v, 'status') == 'blocked').length,
    );
    if (mounted) setState(() => _c = c);
    return ApiPage(_status.isEmpty ? hit : hit.where((v) => jStr(v, 'status') == _status).toList());
  }

  void _setStatus(String s) {
    setState(() => _status = s);
    _useCache = true;
    _key.currentState?.reload();
  }

  void _toggle(String s) => _setStatus(_status == s ? 'active' : s);

  Future<void> _import() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Import vendors', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading)),
            const SizedBox(height: 8),
            const Text('One vendor per row. Only Company Name is required. A vendor already in the master (same name or GSTIN) is left unchanged.'),
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              secondaryBtn('Download template', () {
                Navigator.pop(ctx);
                openApiFile(context, '/p2p/vendors/import/template', 'vendor_import_template.csv');
              }, icon: Icons.download_outlined),
              primaryBtn('Pick file & import', () {
                Navigator.pop(ctx);
                _doImport();
              }, icon: Icons.upload_file_outlined),
            ]),
          ]),
        ),
      ),
    );
  }

  Future<void> _doImport() async {
    final f = await Files.pickFile(extensions: ['csv', 'xlsx']);
    if (f == null || !mounted) return;
    final r = await withLoading(context, () async => asJson(await Api.post('/p2p/vendors/import', data: formData({'file': f}))));
    if (r == null || !mounted) return;
    await showResultDialog(context, 'Import finished', [
      'Added: ${jStrings(r, 'created').length}',
      if (jStrings(r, 'existing').isNotEmpty) 'Already in master: ${jStrings(r, 'existing').length}',
    ], [for (final e in jList(r, 'errors')) 'Row ${e['row']}: ${e['reason']}']);
    _key.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    if (!_allowed) return const EmptyView("You don't have access to Vendors. Ask an admin to give you Procurement › Vendors › View.");
    return Scaffold(
      floatingActionButton: P2pAccess.can('vendors', 'create')
          ? CreateFab(
              label: 'Add Vendor',
              onPressed: () async {
                final v = await openVendorForm(context);
                if (v != null && context.mounted) {
                  _key.currentState?.reload();
                  openScreen(context, VendorDetailScreen(vendorId: jInt(v, 'id')!));
                }
              })
          : null,
      body: ApiListView(
        key: _key,
        load: _load,
        searchHint: 'Search name, code, GSTIN, city, contact…',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          PageHeader('Vendors', actions: [
            if (P2pAccess.can('vendors', 'export'))
              IconButton(
                  tooltip: 'Export',
                  icon: const Icon(Icons.download_outlined),
                  onPressed: () => openApiFile(context, '/p2p/vendors/export', 'vendors.xlsx', query: {if (_search.isNotEmpty) 'search': _search})),
            if (P2pAccess.can('vendors', 'import')) IconButton(tooltip: 'Import', icon: const Icon(Icons.upload_outlined), onPressed: _import),
          ]),
          ChipStrip([
            CountChip('Vendors', _c.all, selected: _status.isEmpty, color: const Color(0xFF3B82F6), onTap: () => _setStatus('')),
            CountChip('Active', _c.active, selected: _status == 'active', color: const Color(0xFF16A34A), onTap: () => _toggle('active')),
            CountChip('Inactive', _c.inactive, selected: _status == 'inactive', color: const Color(0xFF78716C), onTap: () => _toggle('inactive')),
            CountChip('Blocked', _c.blocked, selected: _status == 'blocked', color: const Color(0xFFDC2626), onTap: () => _toggle('blocked')),
          ]),
        ]),
        emptyText: (_all ?? const []).isEmpty
            ? 'No vendors yet — use + Add Vendor or Import a list.'
            : 'No ${_statusLabel[_status]?.toLowerCase() ?? ''} vendors${_search.isNotEmpty ? ' for this search' : ''} — tap the Vendors count to show all.',
        itemBuilder: (ctx, v, reload) => RecordCard(
          code: jStr(v, 'code'),
          title: jStr(v, 'name') ?? '—',
          subtitle: [jStr(v, 'contact_name'), jStr(v, 'contact_phone')].whereType<String>().join(' · '),
          trailing: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Pill(_statusLabel[jStr(v, 'status')] ?? '${v['status']}', Color(_statusHex[jStr(v, 'status')] ?? 0xFF78716C))),
          meta: [
            ('City', jStr(v, 'city') ?? '—'),
            ('GSTIN', jStr(v, 'gstin') ?? '—'),
            ('Referred', jStr(v, 'referred_by_label') ?? '—'),
            ('Added by', jStr(v, 'created_by_name') ?? '—'),
            ('Catalog', fmtNumber(v['catalog_count'] ?? 0)),
          ],
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => VendorDetailScreen(vendorId: jInt(v, 'id')!)));
            _key.currentState?.reload();
          },
        ),
      ),
    );
  }
}

Future<void> showResultDialog(BuildContext context, String title, List<String> summary, List<String> errors) => showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            for (final s in summary) Text(s),
            for (final e in errors) Padding(padding: const EdgeInsets.only(top: 6), child: Text(e, style: const TextStyle(color: Brand.danger))),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );

/// Add / edit a vendor; returns the saved vendor.
Future<Json?> openVendorForm(BuildContext context, {Json? vendor}) async {
  const fields = [
    ('name', 'Company name'), ('contact_name', 'Contact person'), ('contact_phone', 'Contact number'), ('contact_email', 'Email'),
    ('website', 'Website'), ('address', 'Address'), ('city', 'City'), ('state', 'State'), ('pin_code', 'PIN'), ('gstin', 'GSTIN'),
  ];
  final ctl = {for (final f in fields) f.$1: TextEditingController(text: jStr(vendor, f.$1) ?? '')};
  final terms = TextEditingController(text: jStr(vendor, 'terms_conditions') ?? '');
  var status = jStr(vendor, 'status') ?? 'active';
  var msmeCat = jStr(vendor, 'msme_category') ?? '';
  var msmeAct = jStr(vendor, 'msme_activity') ?? '';
  final udyam = TextEditingController(text: jStr(vendor, 'udyam_number') ?? '');
  final payDays = TextEditingController(text: vendor?['payment_days'] != null ? '${vendor!['payment_days']}' : '');
  // Referred by: '' | direct | external | u:<id>
  var refChoice = '';
  String? refLabel;
  final refName = TextEditingController();
  final refPhone = TextEditingController();
  final rt = jStr(vendor, 'referral_type');
  if (rt == 'employee' && vendor?['referred_by_user_id'] != null) {
    refChoice = 'u:${vendor!['referred_by_user_id']}';
    refLabel = jStr(vendor, 'referred_by_user_name') ?? 'Former employee';
  } else if (rt == 'external') {
    refChoice = 'external';
    refName.text = jStr(vendor, 'referred_by_name') ?? '';
    refPhone.text = jStr(vendor, 'referred_by_phone') ?? '';
  } else if (rt != null) {
    refChoice = 'direct';
  }
  final refRequired = vendor == null || rt != null;
  Json? saved;
  final ok = await showFormSheet(
    context,
    title: vendor != null ? 'Edit ${vendor['name']}' : 'Add vendor',
    saveLabel: vendor != null ? 'Save changes' : 'Add vendor',
    builder: (ctx, setS) {
      final isMsme = msmeCat.isNotEmpty;
      return [
        const FormHeading('Company'),
        AppTextField(label: 'Company name', required: true, controller: ctl['name']),
        AppSelect<String>(
          label: 'Who referred this vendor?',
          required: refRequired,
          value: refChoice.isEmpty ? null : refChoice,
          valueLabel: refChoice.startsWith('u:') ? refLabel : null,
          loadOptions: (q) async => [
            const Option('direct', 'Direct (no referral)'),
            const Option('external', 'External / other person or company'),
            for (final o in await directoryOptions(q)) Option('u:${o.value}', o.label, subtitle: o.subtitle),
          ],
          onChanged: (o) => setS(() {
            refChoice = o?.value ?? '';
            refLabel = o?.label;
          }),
        ),
        if (refChoice == 'external') ...[
          AppTextField(label: 'Name / company', required: true, controller: refName),
          AppTextField(label: 'Phone', controller: refPhone, keyboardType: TextInputType.phone),
        ],
        const FormHeading('Contact'),
        AppTextField(label: 'Contact person', controller: ctl['contact_name']),
        AppTextField(label: 'Contact number', controller: ctl['contact_phone'], keyboardType: TextInputType.phone),
        AppTextField(label: 'Email', controller: ctl['contact_email'], keyboardType: TextInputType.emailAddress),
        AppTextField(label: 'Website', controller: ctl['website']),
        const FormHeading('Address'),
        AppTextField(label: 'Address', controller: ctl['address'], maxLines: 2),
        AppTextField(label: 'City', controller: ctl['city']),
        AppTextField(label: 'State', controller: ctl['state']),
        AppTextField(label: 'PIN', controller: ctl['pin_code'], keyboardType: TextInputType.number),
        AppTextField(label: 'GSTIN', controller: ctl['gstin']),
        if (vendor != null) Hint('Created by ${jStr(vendor, 'created_by_name') ?? '—'}${vendor['created_at'] != null ? ' on ${fmtDate(vendor['created_at'])}' : ''}'),
        const FormHeading('MSME & Payment'),
        AppSelect<String>(
          label: 'MSME category',
          value: msmeCat.isEmpty ? null : msmeCat,
          options: const [Option('micro', 'Micro'), Option('small', 'Small'), Option('medium', 'Medium')],
          onChanged: (o) => setS(() => msmeCat = o?.value ?? ''),
        ),
        AppSelect<String>(
          label: 'MSME activity',
          enabled: isMsme,
          value: msmeAct.isEmpty ? null : msmeAct,
          options: const [Option('manufacturing', 'Manufacturing'), Option('services', 'Services'), Option('trader', 'Trader')],
          onChanged: (o) => setS(() => msmeAct = o?.value ?? ''),
        ),
        AppTextField(label: 'Udyam registration no.', controller: udyam, enabled: isMsme, hint: 'UDYAM-HR-05-0012345'),
        AppTextField(label: 'Payment days', controller: payDays, keyboardType: TextInputType.number),
        Hint(isMsme
            ? 'MSMED Act: pay within the agreed days, at most 45 days from acceptance (15 days if none agreed). Micro / small dues unpaid past the limit at '
                '31 March are disallowed under sec. 43B(h) — see Finance › Outstanding › MSME dues.'
            : 'Choose an MSME category (Micro, Small or Medium) to fill the activity and Udyam number.'),
        const FormHeading("Vendor's terms & conditions"),
        AppTextField(label: "Vendor's terms & conditions", controller: terms, maxLines: 4, hint: 'e.g. 30 days credit, prices ex-works Pune, freight extra'),
        const FormHeading('Status'),
        AppSelect<String>(
          label: 'Status',
          value: status,
          clearable: false,
          options: const [Option('active', 'Active'), Option('inactive', 'Inactive'), Option('blocked', 'Blocked')],
          onChanged: (o) => setS(() => status = o?.value ?? 'active'),
        ),
      ];
    },
    onSave: () async {
      final name = ctl['name']!.text.trim();
      final email = ctl['contact_email']!.text.trim();
      final gst = ctl['gstin']!.text.trim();
      final pin = ctl['pin_code']!.text.trim();
      if (name.isEmpty) throw "Company name is required — type the vendor's registered name.";
      if (email.isNotEmpty && !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
        throw 'Email: enter a valid email address, for example name@company.com.';
      }
      if (gst.isNotEmpty && gst.length != 15) throw 'GSTIN: a GSTIN has exactly 15 characters — check it on the GST certificate.';
      if (pin.isNotEmpty && !RegExp(r'^\d{6}$').hasMatch(pin)) throw 'PIN: a PIN code has exactly 6 digits.';
      if (msmeCat.isNotEmpty && payDays.text.trim().isNotEmpty && (int.tryParse(payDays.text.trim()) ?? 0) > 45) {
        throw 'MSME vendors must be paid within 45 days — enter 45 or less.';
      }
      if (refChoice.isEmpty && refRequired) {
        throw "Choose who referred this vendor — pick an employee, 'External / other', or 'Direct (no referral)'.";
      }
      if (refChoice == 'external' && refName.text.trim().isEmpty) {
        throw "Enter the name (person or company) who referred this vendor, or choose 'Direct (no referral)'.";
      }
      String? v(String t) => t.trim().isEmpty ? null : t.trim();
      final payload = <String, dynamic>{
        for (final f in fields) f.$1: v(ctl[f.$1]!.text),
        'terms_conditions': v(terms.text),
        'status': status,
        'msme_category': v(msmeCat),
        'msme_activity': v(msmeAct),
        'udyam_number': v(udyam.text),
        'payment_days': payDays.text.trim().isEmpty ? null : int.tryParse(payDays.text.trim()),
        if (refChoice == 'direct') ...{'referral_type': 'direct', 'referred_by_user_id': null, 'referred_by_name': null, 'referred_by_phone': null},
        if (refChoice == 'external') ...{
          'referral_type': 'external',
          'referred_by_user_id': null,
          'referred_by_name': refName.text.trim(),
          'referred_by_phone': v(refPhone.text),
        },
        if (refChoice.startsWith('u:')) ...{
          'referral_type': 'employee',
          'referred_by_user_id': int.parse(refChoice.substring(2)),
          'referred_by_name': null,
          'referred_by_phone': null,
        },
      };
      saved = asJson(vendor != null ? await Api.patch('/p2p/vendors/${vendor['id']}', data: payload) : await Api.post('/p2p/vendors', data: payload));
    },
  );
  return ok ? saved : null;
}

class VendorDetailScreen extends StatefulWidget {
  const VendorDetailScreen({super.key, required this.vendorId});
  final int vendorId;

  @override
  State<VendorDetailScreen> createState() => _VendorDetailScreenState();
}

class _VendorDetailScreenState extends State<VendorDetailScreen> {
  Json? _v;
  List<Json> _docs = [];
  List<Json> _items = [];
  List<Json> _docTypes = [];
  Object? _error;
  bool _uploading = false;

  bool get _canEdit => P2pAccess.can('vendors', 'edit');
  bool get _viaTab => P2pAccess.can('vendors', 'view');
  bool _vf(String f, String a) => !_viaTab || P2pAccess.feat('vendors', f, a);
  bool get _seeDocs => P2pAccess.feat('vendors', 'documents', 'view');
  bool get _seeCatalog => _vf('catalog', 'view');
  bool get _seePrices => !_viaTab || _canEdit || P2pAccess.feat('vendors', 'prices', 'view');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = widget.vendorId;
    try {
      final r = await Future.wait([
        Api.get('/p2p/vendors/$id'),
        _seeDocs ? Api.get('/p2p/vendors/$id/documents') : Future.value(<dynamic>[]),
        _seeCatalog ? Api.get('/p2p/vendors/$id/catalog') : Future.value(<dynamic>[]),
        Api.get('/p2p/vendors/meta'),
      ]);
      if (!mounted) return;
      setState(() {
        _v = asJson(r[0]);
        _docs = asList(r[1]);
        _items = asList(r[2]);
        _docTypes = jList(asJson(r[3]), 'doc_types');
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _upload() async {
    var type = _docTypes.isNotEmpty ? (jStr(_docTypes.first, 'value') ?? 'catalog') : 'catalog';
    type = _docTypes.any((d) => jStr(d, 'value') == 'catalog') ? 'catalog' : type;
    final picked = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Document type'),
        children: [
          for (final d in _docTypes) SimpleDialogOption(onPressed: () => Navigator.pop(ctx, jStr(d, 'value')), child: Text(jStr(d, 'label') ?? '')),
        ],
      ),
    );
    if (picked == null || !mounted) return;
    final files = await Files.pickFiles();
    if (files.isEmpty || !mounted) return;
    setState(() => _uploading = true);
    final ok = await runAction(context, () => Api.post('/p2p/vendors/${widget.vendorId}/documents', data: formData({'doc_type': picked, 'files': files})),
        success: 'Uploaded.');
    if (mounted) setState(() => _uploading = false);
    if (ok) _load();
  }

  Future<void> _itemForm(Json? c) async {
    const keys = [
      ('item_name', 'Item name'), ('part_code', 'Part code'), ('make', 'Make'), ('dimensions', 'Dimensions'), ('unit', 'Unit'),
      ('unit_price', 'Price'), ('currency', 'Currency'), ('lead_time_days', 'Lead time (days)'), ('technical_spec', 'Technical specification'),
    ];
    final ctl = {for (final k in keys) k.$1: TextEditingController(text: c?[k.$1] != null ? '${c![k.$1]}' : (k.$1 == 'currency' ? 'INR' : ''))};
    final ok = await showFormSheet(context,
        title: c != null ? 'Edit catalog item' : 'Add catalog item',
        saveLabel: c != null ? 'Save item' : 'Add item',
        builder: (ctx, setS) => [
              Hint('An item ${_v?['name'] ?? 'this vendor'} sells — RFQs and POs can pick it from the catalog.'),
              const FormHeading('Item'),
              for (final k in keys.take(4)) AppTextField(label: k.$2, required: k.$1 == 'item_name', controller: ctl[k.$1]),
              const FormHeading('Price & Lead Time'),
              AppTextField(label: 'Unit', controller: ctl['unit']),
              AppTextField(label: 'Price', controller: ctl['unit_price'], keyboardType: AppTextField.number),
              AppTextField(label: 'Currency', controller: ctl['currency']),
              AppTextField(label: 'Lead time (days)', controller: ctl['lead_time_days'], keyboardType: TextInputType.number),
              const FormHeading('Technical specification'),
              AppTextField(label: 'Technical specification', controller: ctl['technical_spec'], maxLines: 3),
            ],
        onSave: () async {
          if (ctl['item_name']!.text.trim().isEmpty) throw 'Item name is required.';
          final payload = {
            for (final k in keys) k.$1: ctl[k.$1]!.text,
            'unit_price': ctl['unit_price']!.text.trim().isEmpty ? null : double.tryParse(ctl['unit_price']!.text.trim()),
            'lead_time_days': ctl['lead_time_days']!.text.trim().isEmpty ? null : int.tryParse(ctl['lead_time_days']!.text.trim()),
          };
          if (c != null) {
            await Api.patch('/p2p/vendors/${widget.vendorId}/catalog/${c['id']}', data: payload);
          } else {
            await Api.post('/p2p/vendors/${widget.vendorId}/catalog', data: payload);
          }
        });
    if (ok) _load();
  }

  Future<void> _delete(String kind, Json row, String name) async {
    final yes = await confirmDialog(context,
        title: kind == 'doc' ? 'Delete document?' : 'Delete catalog item?',
        message: 'Remove "$name" from ${_v?['name'] ?? 'this vendor'}?',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context,
        () => Api.delete('/p2p/vendors/${widget.vendorId}/${kind == 'doc' ? 'documents' : 'catalog'}/${row['id']}'),
        success: 'Deleted.');
    if (ok) _load();
  }

  Future<void> _importCatalog() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Import catalog — ${_v?['name'] ?? ''}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading)),
            const SizedBox(height: 8),
            const Text('One item per row: item name, part code, make, unit, price, dimensions, technical specification, lead time. An item already in the '
                'catalog (same name + part code) is updated with the new values.'),
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              secondaryBtn('Download template', () {
                Navigator.pop(ctx);
                openApiFile(context, '/p2p/vendors/${widget.vendorId}/catalog/template', 'vendor_catalog_template.csv');
              }),
              primaryBtn('Pick file & import', () async {
                Navigator.pop(ctx);
                final f = await Files.pickFile(extensions: ['csv', 'xlsx']);
                if (f == null || !mounted) return;
                final r = await withLoading(context,
                    () async => asJson(await Api.post('/p2p/vendors/${widget.vendorId}/catalog/import', data: formData({'file': f}))));
                if (r == null || !mounted) return;
                await showResultDialog(context, 'Import finished', ['Added: ${r['added']}', 'Updated: ${r['updated']}'],
                    [for (final e in jList(r, 'errors')) 'Row ${e['row']}: ${e['reason']}']);
                _load();
              }),
            ]),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final v = _v;
    if (v == null) return SubPage(title: 'Vendor', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    final msme = jStr(v, 'msme_category');
    final place = [jStr(v, 'city'), jStr(v, 'state')].whereType<String>().join(', ');
    String cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
    final canUpload = _canEdit && P2pAccess.feat('vendors', 'documents', 'create');
    return SubPage(
      title: jStr(v, 'code') ?? 'Vendor',
      bottom: _canEdit
          ? primaryBtn('Edit', () async {
              final s = await openVendorForm(context, vendor: v);
              if (s != null) _load();
            })
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Hint('Vendor master — contact, tax details, documents and the items this vendor sells.')),
          DetailSection(jStr(v, 'name') ?? '—', children: [
            Text('Supplier${place.isNotEmpty ? ' in $place' : ''}'
                '${_seeCatalog ? ' with ${v['catalog_count'] ?? 0} catalog item${v['catalog_count'] == 1 ? '' : 's'}' : ''}'
                '${_seeDocs ? '${_seeCatalog ? ' and' : ' with'} ${v['document_count'] ?? 0} document${v['document_count'] == 1 ? '' : 's'} on file' : ''}.'),
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 4, children: [
              Pill(_statusLabel[jStr(v, 'status')] ?? '${v['status']}', Color(_statusHex[jStr(v, 'status')] ?? 0xFF78716C)),
              if (msme != null) Pill('MSME · ${cap(msme)}', const Color(0xFF0891B2)),
              if (jStr(v, 'created_by_name') != null)
                Hint('Added by ${v['created_by_name']}${v['created_at'] != null ? ' on ${fmtDate(v['created_at'])}' : ''}'),
            ]),
            const Divider(height: 24),
            const Caps('Contact'),
            FieldRow('Contact person', jStr(v, 'contact_name')),
            FieldRow('Contact number', jStr(v, 'contact_phone')),
            FieldRow('Email', jStr(v, 'contact_email')),
            const Caps('Address'),
            FieldRow('Address', [jStr(v, 'address'), jStr(v, 'city'), jStr(v, 'state'), jStr(v, 'pin_code')].whereType<String>().join(', ')),
            const Caps('GST & website'),
            FieldRow('GSTIN', jStr(v, 'gstin')),
            FieldRow('Website', jStr(v, 'website')),
            const Caps('MSME & payment'),
            FieldRow('MSME category', msme != null ? cap(msme) : 'Not an MSME'),
            if (msme != null) FieldRow('MSME activity', jStr(v, 'msme_activity') == null ? null : cap(jStr(v, 'msme_activity')!)),
            if (msme != null) FieldRow('Udyam registration no.', jStr(v, 'udyam_number')),
            FieldRow(
                'Payment terms',
                msme != null
                    ? 'Pay within ${((jInt(v, 'payment_days') ?? 15) < 45 ? (jInt(v, 'payment_days') ?? 15) : 45)} days'
                    : v['payment_days'] != null
                        ? '${v['payment_days']} days'
                        : null),
            const Caps('Referral & record'),
            FieldRow('Referred by', jStr(v, 'referred_by_label')),
            FieldRow('Added by',
                jStr(v, 'created_by_name') == null ? null : '${v['created_by_name']}${v['created_at'] != null ? ' · ${fmtDateTime(v['created_at'])}' : ''}'),
            if (jStr(v, 'terms_conditions') != null) FieldRow("Vendor's terms & conditions", v['terms_conditions']),
          ]),
          if (_seeDocs)
            DetailSection('Documents',
                action: canUpload ? secondaryBtn(_uploading ? 'Uploading…' : 'Upload', _uploading ? null : _upload, icon: Icons.attach_file_rounded) : null,
                children: [
                  const Hint('Catalog PDF, GST certificate, PAN, MSME, cancelled cheque…'),
                  const SizedBox(height: 6),
                  if (_docs.isEmpty) Text('No documents yet${canUpload ? ' — use Upload and pick the document type.' : '.'}'),
                  for (final d in _docs)
                    InnerCard(children: [
                      linkBtn('${d['file_name']}', () => openApiFile(context, '/p2p/vendors/${widget.vendorId}/documents/${d['id']}/content', '${d['file_name']}')),
                      Hint('${d['doc_type_label'] ?? ''} · ${jStr(d, 'uploaded_by_name') ?? '—'} · ${fmtDateTime(d['created_at'])}'),
                      if (P2pAccess.can('vendors', 'delete') &&
                          (P2pAccess.isAdmin || d['uploaded_by_id'] == null || jInt(d, 'uploaded_by_id') == P2pAccess.me) &&
                          P2pAccess.feat('vendors', 'documents', 'delete'))
                        linkBtn('Delete', () => _delete('doc', d, '${d['file_name']}'), color: Brand.danger),
                    ]),
                ]),
          if (_seeCatalog)
            DetailSection('Catalog — items this vendor sells', children: [
              Wrap(spacing: 8, runSpacing: 8, children: [
                if (P2pAccess.can('vendors', 'export') && _vf('catalog', 'export') && _seePrices)
                  secondaryBtn('Export',
                      () => openApiFile(context, '/p2p/vendors/${widget.vendorId}/catalog/export', '${v['code'] ?? 'vendor'}_catalog.xlsx')),
                if (P2pAccess.can('vendors', 'import') && _vf('catalog', 'import')) secondaryBtn('Import', _importCatalog),
                if (_canEdit && _vf('catalog', 'create')) primaryBtn('+ Add item', () => _itemForm(null)),
              ]),
              const SizedBox(height: 8),
              if (_items.isEmpty) const Text("No items yet — add them one by one or import the vendor's list."),
              for (final c in _items)
                InnerCard(children: [
                  Text('${c['item_name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  MiniGrid([
                    MiniField('Part code', jStr(c, 'part_code')),
                    MiniField('Make', jStr(c, 'make')),
                    MiniField('Unit', jStr(c, 'unit')),
                    if (_seePrices) MiniField('Price', c['unit_price'] != null ? '${c['currency'] ?? ''} ${fmtNumber(c['unit_price'])}' : '—'),
                    MiniField('Dimensions', jStr(c, 'dimensions')),
                    MiniField('Lead time', c['lead_time_days'] != null ? '${c['lead_time_days']} days' : '—'),
                  ]),
                  if (jStr(c, 'technical_spec') != null) Hint('${c['technical_spec']}'),
                  Wrap(spacing: 12, children: [
                    if (_canEdit && _vf('catalog', 'edit')) linkBtn('Edit', () => _itemForm(c)),
                    if (_canEdit && _vf('catalog', 'delete')) linkBtn('Delete', () => _delete('item', c, '${c['item_name']}'), color: Brand.danger),
                  ]),
                ]),
            ]),
        ]),
      ),
    );
  }
}