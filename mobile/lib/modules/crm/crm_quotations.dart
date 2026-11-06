import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';
import 'crm_record_tabs.dart';

const quotStatusLabels = {
  'draft': 'Draft',
  'submitted': 'Awaiting approval',
  'approved': 'Approved',
  'sent': 'Sent to customer',
  'accepted': 'Accepted',
  'lost': 'Lost',
  'expired': 'Expired',
};
const quotStatusColors = {
  'draft': Color(0xFF64748B),
  'submitted': Color(0xFFD97706),
  'approved': Color(0xFF2563EB),
  'sent': Color(0xFF7C3AED),
  'accepted': Color(0xFF16A34A),
  'lost': Color(0xFFDC2626),
  'expired': Color(0xFFDC2626),
};

const _revFieldLabels = {
  'quotation_type': 'Quotation Type', 'gst_type': 'GST Type', 'quote_date': 'Date of Quote', 'technical_offer_id': 'Technical Offer',
  'client_name': 'Customer/Client', 'client_contact_name': 'Contact Person', 'client_contact_email': 'Contact Email',
  'client_contact_phone': 'Contact Phone', 'valid_until': 'Quote Validity', 'pricing_mode': 'Pricing', 'price': 'Total Price',
  'lump_sum_gst_percent': 'GST % (lump sum)', 'delivery_time': 'Delivery Time', 'payment_terms': 'Payment Terms',
  'discount': 'Discount', 'discount_type': 'Discount Type', 'quote_conditions': 'Quote Conditions', 'notes': 'Notes', 'items': 'Line Items',
};
String _revLabel(String f) => f.startsWith('item_') && f.endsWith('_unit_price') ? 'Price' : (_revFieldLabels[f] ?? f);

Widget quotStatusPill(Object? status) {
  final s = str(status).isEmpty ? 'draft' : str(status);
  return pill(quotStatusLabels[s] ?? s, quotStatusColors[s] ?? Brand.muted);
}

/// Inquiry › Quotations (InquiryDetailPanel.tsx QuotationsTab).
class QuotationsTab extends StatefulWidget {
  const QuotationsTab({super.key, required this.inquiry, required this.org, required this.contact});
  final Json inquiry;
  final Json? org;
  final Json? contact;

  @override
  State<QuotationsTab> createState() => _QuotationsTabState();
}

class _QuotationsTabState extends State<QuotationsTab> {
  List<Json>? _rows;
  Object? _error;

  int get _inqId => asInt(widget.inquiry['id'])!;
  bool get _ownerOrAdmin => CrmPerm.ownerOrAdmin(widget.inquiry['created_by_id']);
  bool get _canCreate => _ownerOrAdmin && CrmPerm.it('quotations', 'create');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = (await Api.list('/crm/inquiries/$_inqId/quotations')).rows;
      if (mounted) {
        setState(() {
          _rows = rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _create() async {
    final ok = await showQuotationForm(context,
        inquiry: widget.inquiry, org: widget.org, contact: widget.contact, existing: _rows ?? const []);
    if (ok) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _rows == null) return ErrorView(crmError(_error!), onRetry: _load);
    if (_rows == null) return const LoadingView();
    final rows = _rows!;
    final prices = CrmPerm.seesQuotePrices;
    return tabList(_load, [
      if (_canCreate) tabButtons([primaryBtn('+ Create Quote', _create)]),
      if (rows.isEmpty) const EmptyView('No quotations yet.'),
      for (final q in rows)
        RecordCard(
          code: '${str(q['quot_number'])} · ${str(q['quotation_type'])}',
          title: str(q['client_name']).isEmpty ? '—' : str(q['client_name']),
          subtitle: joinNonEmpty([
            q['delivery_time'],
            if (q['valid_until'] != null) 'Valid till: ${fmtDate(q['valid_until'])}',
            if (q['submitted_date'] != null) 'Submitted: ${fmtDate(q['submitted_date'])}',
          ], ' · '),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: quotStatusPill(q['status'])),
          meta: [
            ('Items', '${jsonList(q['items']).length}'),
            if ((asInt(q['revision_number']) ?? 0) > 0) ('Revision', 'r${q['revision_number']}'),
            if (prices) ('Grand Total', quotationTotalText(q)),
          ],
          onTap: () => openScreen(
              context,
              QuotationScreen(
                  inquiry: widget.inquiry, org: widget.org, contact: widget.contact, quotation: q, all: rows, onChanged: _load)),
        ),
    ]);
  }
}

double quotationGrandTotal(Json q) {
  final export = q['quotation_type'] == 'Export';
  if (q['pricing_mode'] == 'lumpsum') {
    final p = (asNum(q['price']) ?? 0).toDouble();
    return p * (1 + (export ? 0 : (asNum(q['lump_sum_gst_percent']) ?? 0)) / 100);
  }
  final items = jsonList(q['items']).fold<double>(0, (s, it) => s + (asNum(it['total']) ?? 0).toDouble());
  final d = (asNum(q['discount']) ?? 0).toDouble();
  final disc = d == 0 ? 0 : (q['discount_type'] == 'flat' ? d : items * d / 100);
  return items - disc;
}

String quotationTotalText(Json q) => money(quotationGrandTotal(q), export: q['quotation_type'] == 'Export');

/// One quotation: details, line items, revision history, approval status and actions.
class QuotationScreen extends StatefulWidget {
  const QuotationScreen({
    super.key,
    required this.inquiry,
    required this.org,
    required this.contact,
    required this.quotation,
    required this.all,
    required this.onChanged,
  });
  final Json inquiry;
  final Json? org;
  final Json? contact;
  final Json quotation;
  final List<Json> all;
  final VoidCallback onChanged;

  @override
  State<QuotationScreen> createState() => _QuotationScreenState();
}

class _QuotationScreenState extends State<QuotationScreen> {
  late Json q = widget.quotation;
  Json? _view;
  bool _viewError = false;
  List<Json> _revisions = const [];
  int? _revSel;

  int get _inqId => asInt(widget.inquiry['id'])!;
  int get _id => asInt(q['id'])!;
  String get _status => str(q['status']).isEmpty ? 'draft' : str(q['status']);
  bool get _ownerOrAdmin => CrmPerm.ownerOrAdmin(widget.inquiry['created_by_id']);
  bool get _canModify => _ownerOrAdmin && CrmPerm.it('quotations', 'edit');
  bool get _canCreate => _ownerOrAdmin && CrmPerm.it('quotations', 'create');
  bool get _canSubmit => _ownerOrAdmin && CrmPerm.it('quotations', 'submit');
  bool get _canWork => CrmPerm.it('quotations', 'edit') && _view?['can_work'] != false;
  bool get _prices => CrmPerm.seesQuotePrices;
  bool get _export => q['quotation_type'] == 'Export';

  @override
  void initState() {
    super.initState();
    _loadStatus();
    _loadRevisions();
  }

  Future<void> _loadStatus() async {
    try {
      final v = await Api.get('/crm/inquiries/$_inqId/quotations/$_id/status');
      if (mounted) {
        setState(() {
          _view = v is Map ? Map<String, dynamic>.from(v) : null;
          _viewError = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _viewError = true);
    }
  }

  Future<void> _loadRevisions() async {
    if ((asInt(q['revision_number']) ?? 0) <= 0) return;
    try {
      final r = (await Api.list('/crm/inquiries/$_inqId/quotations/$_id/revisions')).rows;
      if (mounted) setState(() => _revisions = r);
    } catch (e) {
      if (mounted) showSnack(context, crmError(e), error: true);
    }
  }

  Future<void> _reload() async {
    try {
      final rows = (await Api.list('/crm/inquiries/$_inqId/quotations')).rows;
      final fresh = rows.firstWhere((r) => r['id'] == q['id'], orElse: () => q);
      if (mounted) setState(() => q = fresh);
    } catch (_) {}
    widget.onChanged();
    _loadStatus();
    _loadRevisions();
  }

  Future<void> _act(String action, {String? comment}) async {
    final ok = await crmRun(context, () async {
      final r = await Api.post('/crm/inquiries/$_inqId/quotations/$_id/$action', data: {'comment': ?comment});
      if (r is Map && r['status_view'] is Map) _view = Map<String, dynamic>.from(r['status_view'] as Map);
    });
    if (ok) _reload();
  }

  Future<void> _confirmAct(String action, String title, String message, String label) async {
    if (await confirmDialog(context, title: title, message: message, confirmLabel: label)) _act(action);
  }

  Future<void> _promptAct(String action, String title, String message, String label, {required bool required}) async {
    final v = await promptDialog(context, title: title, message: message, label: 'Reason', required: required, confirmLabel: label);
    if (v != null) _act(action, comment: v.isEmpty ? null : v);
  }

  Future<void> _revise({required bool asNew}) async {
    final ok = await showQuotationForm(context,
        inquiry: widget.inquiry,
        org: widget.org,
        contact: widget.contact,
        existing: widget.all,
        source: q,
        asNewRevision: asNew);
    if (!ok) return;
    if (asNew) {
      widget.onChanged();
      if (mounted) Navigator.pop(context);
    } else {
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = jsonList(q['items']);
    final v = _view;
    final selRev = _revisions.where((r) => r['id'] == _revSel).firstOrNull;
    final buttons = <Widget>[
      if (_canSubmit && _status == 'draft')
        primaryBtn(v?['approval_rank'] == 0 ? 'Finalise quotation' : 'Submit for approval', () => _act('submit')),
      if (_canSubmit && _status == 'submitted')
        secondaryBtn('Withdraw',
            () => _confirmAct('withdraw', 'Withdraw from approval?', 'The quotation goes back to draft so you can change it.', 'Withdraw')),
      if (v?['can_decide'] == true && _status == 'submitted') ...[
        primaryBtn('Approve', () => _confirmAct('approve', 'Approve this quotation?',
            'Quotation ${str(q['quot_number'])} is approved and can then be sent to the customer.', 'Approve')),
        secondaryBtn('Return', () => _promptAct('return', 'Return for changes', 'Tell the creator what to change.', 'Return', required: true)),
        dangerBtn('Reject',
            () => _promptAct('reject', 'Reject this quotation', 'The quotation goes back to draft with your reason.', 'Reject', required: true)),
      ],
      if (_canWork && _status == 'approved') primaryBtn('Mark as sent to customer', () => _act('send')),
      if (_canWork && _status == 'sent')
        primaryBtn('Customer accepted', () => _promptAct('accept', 'Customer accepted this quotation',
            'Any remarks from the customer (optional).', 'Record acceptance', required: false)),
      if (_canWork && (_status == 'approved' || _status == 'sent'))
        dangerBtn('Customer rejected / lost', () => _promptAct('lost', 'Customer did not take this quotation',
            "Why didn't the customer take it?", 'Mark as lost', required: true)),
      if (CrmPerm.it('quotations', 'print') && _prices)
        secondaryBtn('Download PDF', () => openApiFile(context, '/crm/inquiries/$_inqId/quotations/$_id/pdf',
            '${str(q['quot_number']).isEmpty ? 'Quotation-$_id' : str(q['quot_number'])}.pdf')),
      if (_canCreate && _status != 'draft') secondaryBtn('Create revision from this quotation', () => _revise(asNew: true)),
      if (_canModify && _status == 'draft') secondaryBtn('Edit', () => _revise(asNew: false)),
    ];
    return SubPage(
      title: str(q['quot_number']).isEmpty ? 'Quotation' : str(q['quot_number']),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          DetailSection('Status', children: [
            Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              quotStatusPill(_status),
              if (q['customer_response'] == 'Negotiating' && _status == 'sent')
                const Text('Customer negotiating', style: TextStyle(fontSize: 12, color: Color(0xFF7C3AED))),
            ]),
            if (v != null && _status == 'draft' && str(v['approval_label']).isNotEmpty && v['approval_rank'] != 0)
              Note('Needs ${v['approval_label']} approval${strList(v['approval_reasons']).isEmpty ? '' : ' (${strList(v['approval_reasons']).join('; ')})'}',
                  padding: const EdgeInsets.only(top: 6)),
            if (v?['approval_pending'] == true)
              Note('${str(v!['approval_stage'])} stage${strList(v['approval_waiting_on']).isEmpty ? '' : ' — waiting on ${strList(v['approval_waiting_on']).join(', ')}'}',
                  color: const Color(0xFFB45309), padding: const EdgeInsets.only(top: 6)),
            if (str(q['status_comment']).isNotEmpty && ['draft', 'lost', 'accepted'].contains(_status))
              Note(str(q['status_comment']), padding: const EdgeInsets.only(top: 6)),
            if (_status == 'approved' && !_canWork)
              const Note('Approved — the quotation\'s creator or the inquiry owner marks it as sent to the customer.',
                  padding: EdgeInsets.only(top: 6)),
            if (_status == 'expired')
              const Note('Validity ended without a decision — use "Create revision from this quotation" to offer it again (a finalised quotation can\'t be edited).',
                  padding: EdgeInsets.only(top: 6)),
            if (_viewError) ...[
              const SizedBox(height: 8),
              const ErrorBanner('Approval details could not be loaded — pull down to reload; if it persists check your connection.'),
            ],
          ]),
          if (_revisions.isNotEmpty)
            DetailSection('Revisions', children: [
              AppSelect<int>(
                label: 'Show what changed in',
                value: _revSel,
                options: [
                  for (final r in _revisions)
                    Option(asInt(r['id'])!, 'Revision ${str(r['revision_number'] ?? r['revision'] ?? r['id'])}',
                        subtitle: joinNonEmpty([r['performed_by'], fmtDateTime(r['performed_at'])], ' · ')),
                ],
                onChanged: (o) => setState(() => _revSel = o?.value),
              ),
              if (selRev != null) ...[
                const SizedBox(height: 8),
                Text(changesText(jsonList(selRev['changes']), label: _revLabel), style: const TextStyle(fontSize: 13)),
              ],
            ]),
          DetailSection('Quotation', children: [
            row('Quotation Type', q['quotation_type']),
            if (!_export) row('GST Type', q['gst_type'] == 'IGST' ? 'IGST (Inter-state)' : 'CGST + SGST (Intra-state)'),
            row('Pricing', q['pricing_mode'] == 'lumpsum' ? 'Lump sum (one total price)' : 'Item-wise (price per line)'),
            row('Date of Quote', fmtDate(q['quote_date'])),
            row('Technical Offer',
                str(q['technical_offer_number']).isEmpty ? null : '${q['technical_offer_number']} · ${fmtDate(q['technical_offer_date'])}'),
          ]),
          DetailSection('Customer', children: [
            row('Customer/Client', q['client_name']),
            row('Contact', joinNonEmpty([q['client_contact_name'], q['client_contact_email'], q['client_contact_phone']], ' · ')),
          ]),
          DetailSection('Line Items (${items.length})', children: [
            for (final it in items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${txt(it['description'])}${str(it['model_number']).isEmpty ? '' : ' · Model - ${it['model_number']}'}',
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                  if (str(it['application_name']).isNotEmpty) Note('Application: ${it['application_name']}'),
                  if (str(it['details']).isNotEmpty) Note(str(it['details'])),
                  Note(joinNonEmpty([
                    'Qty ${fmtQty(it['quantity'])}',
                    if (_prices && q['pricing_mode'] != 'lumpsum') 'Price/Unit ${fmtAmount(asNum(it['unit_price']) ?? 0)}',
                    if (!_export && q['pricing_mode'] != 'lumpsum') 'GST ${txt(it['gst_percent'])}%',
                    if (_prices && q['pricing_mode'] != 'lumpsum') 'Subtotal ${fmtAmount(asNum(it['subtotal']) ?? 0)}',
                    if (_prices && q['pricing_mode'] != 'lumpsum') 'Total ${fmtAmount(asNum(it['total']) ?? 0)}',
                  ], ' · '), color: Brand.body),
                ]),
              ),
            if (_prices && q['pricing_mode'] == 'lumpsum')
              FieldRow('Total Price',
                  '${_export ? '\$' : '₹'}${fmtAmount(asNum(q['price']) ?? 0)}${!_export && q['lump_sum_gst_percent'] != null ? ' + ${q['lump_sum_gst_percent']}% GST' : ''}'),
            if (_prices && q['pricing_mode'] != 'lumpsum' && (asNum(q['discount']) ?? 0) > 0)
              FieldRow('Discount',
                  q['discount_type'] == 'flat' ? '${_export ? 'USD' : 'INR'} ${q['discount']}' : '${q['discount']}%'),
            if (_prices) FieldRow('Grand Total', quotationTotalText(q)),
          ]),
          DetailSection('Terms', children: [
            row('Delivery Time', q['delivery_time']),
            row('Quote Validity Date', fmtDate(q['valid_until'])),
            row('Quote Conditions', q['quote_conditions']),
            row('Payment Terms', q['payment_terms']),
            row('Notes', q['notes'], hideEmpty: true),
            row('Submitted', q['submitted_date'] == null ? null : fmtDate(q['submitted_date']), hideEmpty: true),
          ]),
          if (_prices)
            ManagedWordDoc(
              entityType: 'crm_quotation',
              entityId: _id,
              revision: asInt(q['revision_number']) ?? 0,
              canModify: _canModify && ['draft', 'submitted'].contains(_status),
              recordLabel: 'quotation',
              downloadName: str(q['quot_number']).isEmpty ? 'Quotation-$_id' : str(q['quot_number']),
            ),
        ]),
      ),
      bottom: buttons.isEmpty ? null : actionBar(buttons),
    );
  }
}

/// The record's editable Word document of record (components/shared/ManagedDocumentPanel.tsx):
/// "Save & Edit in Word" opens Word on the phone, Download .docx, version history.
class ManagedWordDoc extends StatefulWidget {
  const ManagedWordDoc({
    super.key,
    required this.entityType,
    required this.entityId,
    required this.revision,
    required this.canModify,
    required this.recordLabel,
    required this.downloadName,
  });
  final String entityType;
  final int entityId;
  final int revision;
  final bool canModify;
  final String recordLabel;
  final String downloadName;

  @override
  State<ManagedWordDoc> createState() => _ManagedWordDocState();
}

class _ManagedWordDocState extends State<ManagedWordDoc> with WidgetsBindingObserver {
  Json? _doc;
  bool _loaded = false;
  String? _loadError;
  bool _busy = false;
  bool _history = false;

  String get _base => '/managed-documents/${widget.entityType}/${widget.entityId}';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Back from Word: pick up the new version.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      if (mounted) {
        setState(() {
          _doc = r is Map && r['document'] is Map ? Map<String, dynamic>.from(r['document'] as Map) : null;
          _loadError = null;
          _loaded = true;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loadError = 'Could not load the Word document status. ${crmError(e)}';
          _loaded = true;
        });
      }
    }
  }

  Future<void> _editInWord() async {
    setState(() => _busy = true);
    await crmRun(context, () async {
      final cur = await Api.get(_base);
      final doc = cur is Map ? cur['document'] : null;
      if (doc == null || (doc is Map && doc['is_stale'] == true)) await Api.post(_base);
      final r = await Api.post('$_base/edit');
      final url = r is Map ? str(r['url']) : '';
      if (url.isEmpty) throw 'The server gave no Word link for this ${widget.recordLabel}. Try again in a minute.';
      await Files.openUrl(url);
    });
    if (mounted) setState(() => _busy = false);
    Future.delayed(const Duration(milliseconds: 1500), _load);
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const SizedBox.shrink();
    final doc = _doc;
    if (doc == null && !widget.canModify && _loadError == null) return const SizedBox.shrink();
    final versions = jsonList(doc?['versions']);
    final latest = versions.firstOrNull;
    final stale = doc?['is_stale'] == true;
    return DetailSection(
      'Word document${latest == null ? '' : ' · v${latest['version']}'}',
      children: [
        if (latest != null)
          Note('Last change by ${str(latest['modified_by'])}${latest['modified_at'] == null ? '' : ', ${fmtDateTime(latest['modified_at'])}'}'),
        if (_loadError != null) ErrorBanner(_loadError!),
        if (stale)
          Note('This Word draft was made from an older version of the ${widget.recordLabel}, so it may not match.'
              '${widget.canModify ? ' Use "Rebuild from current revision & edit".' : ''}', color: const Color(0xFFB45309)),
        if (str(doc?['versions_error']).isNotEmpty) Note(str(doc!['versions_error']), color: Brand.danger),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (widget.canModify && (doc != null || _loadError == null))
            wordBtn(
                _busy
                    ? 'Opening Word…'
                    : doc == null
                        ? 'Save & Edit in Word'
                        : stale
                            ? 'Rebuild from current revision & edit'
                            : 'Edit in Word',
                _busy ? null : _editInWord),
          if (doc != null)
            secondaryBtn('Download .docx', () => openApiFile(context, '$_base/docx', '${widget.downloadName}.docx')),
          if (versions.isNotEmpty)
            secondaryBtn(_history ? 'Hide history' : 'History (${versions.length} versions)', () => setState(() => _history = !_history)),
        ]),
        if (_history)
          for (final v in versions)
            FieldRow('v${v['version']} · ${str(v['action'])}', '${str(v['modified_by'])}  ${fmtDateTime(v['modified_at'])}'),
      ],
    );
  }
}

// ── Quotation form ───────────────────────────────────────────────────────────

class _Line {
  _Line({
    this.productId,
    this.productLabel,
    this.applicationId,
    String model = '',
    String qty = '',
    String price = '',
    String gst = '',
    String details = '',
  })  : model = TextEditingController(text: model),
        qty = TextEditingController(text: qty),
        price = TextEditingController(text: price),
        gst = TextEditingController(text: gst),
        details = TextEditingController(text: details);

  int? productId;
  String? productLabel;
  int? applicationId;
  final TextEditingController model;
  final TextEditingController qty;
  final TextEditingController price;
  final TextEditingController gst;
  final TextEditingController details;
  String description = '';

  bool get isEmpty =>
      productId == null &&
      applicationId == null &&
      description.trim().isEmpty &&
      model.text.trim().isEmpty &&
      details.text.trim().isEmpty &&
      qty.text.trim().isEmpty &&
      price.text.trim().isEmpty &&
      gst.text.trim().isEmpty;

  double subtotal() => (double.tryParse(qty.text) ?? 0) * (double.tryParse(price.text) ?? 0);
  double total(bool export) => subtotal() * (1 + (export ? 0 : (double.tryParse(gst.text) ?? 0)) / 100);

  static String n(Object? v) => v == null ? '' : fmtQty(v) == '—' ? '' : (asNum(v)!.toString().replaceFirst(RegExp(r'\.0$'), ''));

  factory _Line.of(Json it) {
    final l = _Line(
      productId: asInt(it['product_id']),
      productLabel: str(it['product_name']).isNotEmpty ? str(it['product_name']) : str(it['description']),
      applicationId: asInt(it['application_id']),
      model: str(it['model_number']),
      qty: n(it['quantity']),
      price: n(it['unit_price']),
      gst: n(it['gst_percent']),
      details: str(it['details']),
    );
    l.description = str(it['description']);
    return l;
  }
}

final _deliveryPattern = RegExp(r'\d+.*\b(day|days|week|weeks|month|months|hour|hours|hrs?)\b', caseSensitive: false);

/// Create / edit / "revision as new" quotation (QuotationsTab form). True when saved.
Future<bool> showQuotationForm(
  BuildContext context, {
  required Json inquiry,
  required Json? org,
  required Json? contact,
  required List<Json> existing,
  Json? source,
  bool asNewRevision = false,
}) async {
  final inqId = asInt(inquiry['id'])!;
  final editing = source != null && !asNewRevision ? source : null;
  final prices = CrmPerm.seesQuotePrices;

  // Lookups: products + applications, payment terms, technical offers.
  List<Json> products = const [];
  List<Json> paymentTerms = const [];
  List<Json> offers = const [];
  final loadErrors = <String>[];
  try {
    final d = await Api.get('/crm/quotation-products');
    if (d is Map) products = [...jsonList(d['products']), ...jsonList(d['applications'])];
  } catch (e) {
    loadErrors.add('Could not load the product list for quotation lines. ${crmError(e)}');
  }
  try {
    paymentTerms = (await Api.list('/crm/payment-terms')).rows;
  } catch (_) {}
  try {
    offers = (await Api.list('/crm/inquiries/$inqId/technical-offers')).rows;
  } catch (e) {
    loadErrors.add("Could not load R&D's Technical Offers for this inquiry. ${crmError(e)}");
  }
  if (!context.mounted) return false;

  final today = DateTime.now();
  final s = source;
  var quotationType = str(s?['quotation_type']).isEmpty ? 'Domestic' : str(s!['quotation_type']);
  var gstType = str(s?['gst_type']).isEmpty ? 'CGST_SGST' : str(s!['gst_type']);
  var pricingMode = str(s?['pricing_mode']).isEmpty ? 'itemwise' : str(s!['pricing_mode']);
  DateTime? quoteDate = (editing != null ? dateOf(editing['quote_date']) : null) ?? today;
  DateTime? validUntil = editing != null ? dateOf(editing['valid_until']) : quoteDate.add(const Duration(days: 30));
  final released = offers.where((o) => o['status'] == 'released').firstOrNull;
  int? offerId = s != null ? asInt(s['technical_offer_id']) : asInt(released?['id']);
  final clientName = TextEditingController(text: s != null ? str(s['client_name']) : str(org?['name']));
  final contactName = TextEditingController(text: s != null ? str(s['client_contact_name']) : str(contact?['name']));
  final contactEmail = TextEditingController(text: s != null ? str(s['client_contact_email']) : str(contact?['email']));
  final contactPhone = TextEditingController(text: s != null ? str(s['client_contact_phone']) : str(contact?['mobile']));
  final delivery = TextEditingController(text: str(s?['delivery_time']));
  final paymentText = TextEditingController(text: str(s?['payment_terms']));
  final notes = TextEditingController(text: str(s?['notes']));
  final discount = TextEditingController(text: s?['discount'] == null ? '' : _Line.n(s!['discount']));
  var discountType = str(s?['discount_type']).isEmpty ? 'percent' : str(s!['discount_type']);
  final conds = str(s?['quote_conditions']);
  var conditions = conds.isEmpty ? '' : (CrmLists.quoteConditions.contains(conds) ? conds : 'Other/Custom');
  final conditionsCustom = TextEditingController(text: conds.isNotEmpty && !CrmLists.quoteConditions.contains(conds) ? conds : '');
  final lumpPrice = TextEditingController(text: s?['price'] == null ? '' : _Line.n(s!['price']));
  final lumpGst = TextEditingController(text: s?['lump_sum_gst_percent'] == null ? '18' : _Line.n(s!['lump_sum_gst_percent']));
  var lines = s != null && jsonList(s['items']).isNotEmpty ? jsonList(s['items']).map(_Line.of).toList() : [_Line()];
  String? notice = loadErrors.isEmpty ? null : loadErrors.join('\n');

  Option<int> productOption(Json p) => Option(
        asInt(p['id'])!,
        '${str(p['name'])}${str(p['model_number']).isEmpty ? '' : ' · ${p['model_number']}'}',
        subtitle: p['product_type'] == 'service'
            ? 'Paid services'
            : p['product_type'] == 'application'
                ? 'Applications / attachments'
                : 'Products',
      );
  final productOptions = [for (final p in products) if (asInt(p['id']) != null) productOption(p)];

  Future<void> pickProduct(_Line l, Option<int> o, StateSetter setS) async {
    final p = products.firstWhere((x) => asInt(x['id']) == o.value);
    final changed = l.productId != o.value;
    setS(() {
      l.productId = o.value;
      l.productLabel = o.label;
      l.description = str(p['name']);
      l.model.text = str(p['model_number']);
      if (changed) l.price.text = '';
    });
    if (pricingMode == 'lumpsum' || !prices) return;
    try {
      final r = await Api.get('/crm/inquiries/$inqId/quotation-products/${o.value}/price');
      final price = r is Map ? asNum(r['price']) : null;
      if (price == null) {
        setS(() => notice =
            '${str(p['name'])} has no price for this customer in the Product master — type the Price/unit, or add a price under CRM › Products › ${str(p['name'])} › Pricing.');
      } else if (l.productId == o.value && l.price.text.trim().isEmpty) {
        setS(() => l.price.text = _Line.n(price));
      }
    } catch (_) {}
  }

  Future<void> pickPaymentTerm(StateSetter setS) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      builder: (ctx) => FractionallySizedBox(
        heightFactor: 0.7,
        child: Column(children: [
          const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Payment Terms', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading))),
          Expanded(
            child: ListView(children: [
              for (final t in paymentTerms)
                ListTile(
                  title: Text(str(t['label'])),
                  subtitle: str(t['description']).isEmpty ? null : Text(str(t['description'])),
                  onTap: () => Navigator.pop(ctx, str(t['description']).isEmpty ? str(t['label']) : str(t['description'])),
                ),
              if (paymentText.text.trim().isNotEmpty)
                ListTile(
                  leading: const Icon(Icons.add_rounded, color: Brand.primary),
                  title: const Text('New Payment Term', style: TextStyle(color: Brand.primary, fontWeight: FontWeight.w600)),
                  subtitle: Text('Save "${paymentText.text.trim()}" to the list'),
                  onTap: () => Navigator.pop(ctx, '\u0000new'),
                ),
            ]),
          ),
        ]),
      ),
    );
    if (picked == null) return;
    if (picked == '\u0000new') {
      final text = paymentText.text.trim();
      try {
        final created = await Api.post('/crm/payment-terms', data: {'label': text, 'description': text});
        if (created is Map) paymentTerms = [...paymentTerms, Map<String, dynamic>.from(created)];
      } catch (e) {
        if (context.mounted) {
          showSnack(context, 'Payment term "$text" was not added to the list. ${crmError(e)}', error: true);
        }
      }
      return;
    }
    setS(() => paymentText.text = picked);
  }

  final pastPick = <int?>[null];
  final title = editing != null
      ? 'Edit ${str(editing['quot_number']).isEmpty ? 'Quotation' : str(editing['quot_number'])}'
      : asNewRevision
          ? 'New Quotation (revision)'
          : 'New Quotation';

  return showFormSheet(
    context,
    title: title,
    saveLabel: editing != null ? 'Save Changes' : 'Save Quotation',
    builder: (ctx, setS) {
      final export = quotationType == 'Export';
      final lump = pricingMode == 'lumpsum';
      final sym = export ? '\$' : '₹';
      final itemsTotal = lump
          ? (double.tryParse(lumpPrice.text) ?? 0) * (1 + (export ? 0 : (double.tryParse(lumpGst.text) ?? 0)) / 100)
          : lines.fold<double>(0, (t, l) => t + l.total(export));
      final d = double.tryParse(discount.text) ?? 0;
      final discAmt = lump || d == 0 ? 0.0 : (discountType == 'percent' ? itemsTotal * d / 100 : d);
      final picked = offers.where((o) => asInt(o['id']) == offerId).firstOrNull;
      return [
        Note(editing != null
            ? 'Saving updates this quotation as revision r${(asInt(editing['revision_number']) ?? 0) + 1}; earlier versions stay available in its revision list.'
            : asNewRevision
                ? 'Pre-filled from ${str(source?['quot_number'])} (items and terms). Dates are reset; saving creates a new draft quotation that needs approval — ${str(source?['quot_number'])} stays as it is.'
                : 'Price offer to ${str(org?['name']).isEmpty ? 'the customer' : str(org?['name'])} for inquiry ${str(inquiry['universal_id'])}.'),
        if (notice != null)
          InkWell(onTap: () => setS(() => notice = null), child: InfoBox(notice!, color: const Color(0xFF15803D), bg: const Color(0xFFF0FDF4))),
        if (editing == null && !asNewRevision && existing.isNotEmpty) ...[
          const FormSection('Fill from a past quotation (optional)'),
          AppSelect<int>(
            label: "This inquiry's quotations",
            value: pastPick[0],
            options: [
              for (final p in existing)
                Option(asInt(p['id'])!,
                    '${str(p['quot_number']).isEmpty ? 'Quotation #${p['id']}' : str(p['quot_number'])} · ${txt(p['client_name'])}',
                    subtitle: joinNonEmpty([
                      fmtDate(p['quote_date']),
                      '${jsonList(p['items']).length} item${jsonList(p['items']).length == 1 ? '' : 's'}',
                      if (prices) quotationTotalText(p),
                      p['status'],
                    ], ' · ')),
            ],
            onChanged: (o) {
              if (o == null) return;
              final p = existing.firstWhere((x) => asInt(x['id']) == o.value);
              setS(() {
                pastPick[0] = o.value;
                quotationType = str(p['quotation_type']).isEmpty ? 'Domestic' : str(p['quotation_type']);
                gstType = str(p['gst_type']).isEmpty ? 'CGST_SGST' : str(p['gst_type']);
                pricingMode = str(p['pricing_mode']).isEmpty ? 'itemwise' : str(p['pricing_mode']);
                delivery.text = str(p['delivery_time']);
                paymentText.text = str(p['payment_terms']);
                notes.text = str(p['notes']);
                discount.text = p['discount'] == null ? '' : _Line.n(p['discount']);
                discountType = str(p['discount_type']).isEmpty ? 'percent' : str(p['discount_type']);
                final c = str(p['quote_conditions']);
                conditions = c.isEmpty ? '' : (CrmLists.quoteConditions.contains(c) ? c : 'Other/Custom');
                conditionsCustom.text = c.isNotEmpty && !CrmLists.quoteConditions.contains(c) ? c : '';
                lumpPrice.text = p['price'] == null ? '' : _Line.n(p['price']);
                lumpGst.text = p['lump_sum_gst_percent'] == null ? '18' : _Line.n(p['lump_sum_gst_percent']);
                lines = jsonList(p['items']).isEmpty ? [_Line()] : jsonList(p['items']).map(_Line.of).toList();
                notice = 'Filled from ${str(p['quot_number'])} (${txt(p['client_name'])}): line items, prices and terms. Check and edit them before saving.';
              });
            },
          ),
          const Note('Customer, Technical Offer and dates stay as they are for this inquiry; everything copied can be edited before saving.'),
        ],
        const FormSection('Quotation'),
        AppSelect<String>(
          label: 'Quotation Type',
          required: true,
          value: quotationType,
          options: const [Option('Domestic', 'Domestic (INR)'), Option('Export', 'Export (USD)')],
          onChanged: (o) => setS(() => quotationType = o?.value ?? quotationType),
        ),
        if (!export)
          AppSelect<String>(
            label: 'GST Type',
            value: gstType,
            clearable: false,
            options: const [Option('CGST_SGST', 'CGST + SGST (Intra-state)'), Option('IGST', 'IGST (Inter-state)')],
            onChanged: (o) => setS(() => gstType = o?.value ?? gstType),
          ),
        AppSelect<String>(
          label: 'Pricing',
          value: pricingMode,
          clearable: false,
          options: const [Option('itemwise', 'Item-wise (price per line)'), Option('lumpsum', 'Lump sum (one total price)')],
          onChanged: (o) => setS(() => pricingMode = o?.value ?? pricingMode),
        ),
        DateField(
          label: 'Date of Quote',
          required: true,
          value: quoteDate,
          onChanged: (v) => setS(() {
            final keep = validUntil == null || (quoteDate != null && isoDate(validUntil) == isoDate(quoteDate!.add(const Duration(days: 30))));
            quoteDate = v;
            if (keep && v != null) validUntil = v.add(const Duration(days: 30));
          }),
        ),
        if (offers.isEmpty)
          const Note("Technical Offer: No Technical Offer yet — R&D uploads theirs and the R&D head releases it to the BD team, or upload your own in this inquiry's Technical Offers tab.")
        else
          AppSelect<int>(
            label: 'Technical Offer',
            value: offerId,
            options: [
              for (final o in offers)
                Option(asInt(o['id'])!,
                    '${str(o['offer_number'])} · ${str(o['title'])}${o['origin'] == 'bd' ? ' — Uploaded by BD, not reviewed by R&D' : ''}${o['status'] == 'superseded' ? ' (superseded)' : ''}'),
            ],
            onChanged: (o) => setS(() => offerId = o?.value),
          ),
        if (picked != null)
          Note([
            'Technical Offer Date: ${fmtDate(picked['offer_date'])}',
            if (picked['status'] == 'superseded') 'a newer revision exists',
            if (picked['based_on_earlier_revision'] == true) 'based on an earlier requirement revision',
            RegExp(r'\.pdf$', caseSensitive: false).hasMatch(str(picked['file_name']))
                ? '\nTechnical Offer ${picked['offer_number']} is a PDF, so it is attached separately — it is not merged into the Word quotation.'
                : '\nThe quotation document will have Technical Offer ${picked['offer_number']} first, then the commercial quotation on the next page, in one Word file (editable in Word).',
          ].join(' · ')),
        const FormSection('Customer'),
        AppTextField(label: 'Customer/Client', required: true, controller: clientName, hint: 'e.g. Northern Railway HQ'),
        AppTextField(label: 'Contact Person Name', controller: contactName, hint: 'e.g. Rajesh Kumar'),
        AppTextField(label: 'Contact Email', controller: contactEmail, keyboardType: TextInputType.emailAddress, hint: 'e.g. name@company.com'),
        AppTextField(label: 'Contact Phone', controller: contactPhone, keyboardType: TextInputType.phone, hint: 'e.g. +91 98765 43210'),
        const FormSection('Line Items *'),
        for (var i = 0; i < lines.length; i++)
          Container(
            key: ObjectKey(lines[i]),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(
                  child: AppSelect<int>(
                    label: 'Product',
                    required: true,
                    value: lines[i].productId,
                    valueLabel: lines[i].productLabel,
                    options: productOptions,
                    clearable: false,
                    onChanged: (o) {
                      if (o != null) pickProduct(lines[i], o, setS);
                    },
                  ),
                ),
                rowIconButton(Icons.delete_outline_rounded, 'Remove line item', () => setS(() {
                      lines.removeAt(i);
                      if (lines.isEmpty) lines.add(_Line());
                    }), color: Brand.danger),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: AppTextField(label: 'Model No.', controller: lines[i].model)),
                const SizedBox(width: 8),
                Expanded(
                    child: AppTextField(
                        label: 'Qty', controller: lines[i].qty, keyboardType: AppTextField.number, onChanged: (_) => setS(() {}))),
              ]),
              if (!lump) ...[
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(
                      child: AppTextField(
                          label: 'Price/unit ($sym)',
                          controller: lines[i].price,
                          keyboardType: AppTextField.number,
                          onChanged: (_) => setS(() {}))),
                  if (!export) ...[
                    const SizedBox(width: 8),
                    Expanded(
                        child: AppTextField(
                            label: 'GST %', controller: lines[i].gst, keyboardType: AppTextField.number, onChanged: (_) => setS(() {}))),
                  ],
                ]),
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text('Subtotal: $sym${fmtAmount(lines[i].subtotal())}   Total: $sym${fmtAmount(lines[i].total(export))}',
                      style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ),
              ],
              const SizedBox(height: 8),
              AppTextField(
                  label: 'Details (optional)',
                  controller: lines[i].details,
                  maxLines: 3,
                  hint: 'Printed under the item, one per line, e.g. Total 1 year warranty'),
            ]),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: secondaryBtn('Add Line Item', () => setS(() => lines.add(_Line())), icon: Icons.add_rounded),
        ),
        if (lump) ...[
          AppTextField(
              label: 'Total Price ($sym)',
              required: true,
              controller: lumpPrice,
              keyboardType: AppTextField.number,
              hint: 'Price for the whole offer, before GST',
              onChanged: (_) => setS(() {})),
          if (!export)
            AppTextField(label: 'GST %', controller: lumpGst, keyboardType: AppTextField.number, hint: 'e.g. 18', onChanged: (_) => setS(() {})),
        ],
        if (discAmt > 0)
          Align(
              alignment: Alignment.centerRight,
              child: Text('Discount (${discountType == 'percent' ? '${discount.text}%' : '$sym${discount.text}'}): -$sym${fmtAmount(discAmt)}',
                  style: const TextStyle(color: Brand.muted))),
        Align(
          alignment: Alignment.centerRight,
          child: Text('Grand Total: $sym${fmtAmount(itemsTotal - discAmt)}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: Brand.heading)),
        ),
        const FormSection('Terms'),
        AppTextField(label: 'Delivery Time', required: true, controller: delivery, hint: 'e.g. 7 days or 2 weeks'),
        DateField(label: 'Quote Validity Date', required: true, value: validUntil, onChanged: (v) => setS(() => validUntil = v)),
        if (!lump)
          Row(children: [
            Expanded(
                child: AppTextField(
                    label: 'Discount', controller: discount, keyboardType: AppTextField.number, hint: '0', onChanged: (_) => setS(() {}))),
            const SizedBox(width: 8),
            SizedBox(
              width: 110,
              child: AppSelect<String>(
                label: 'Type',
                value: discountType,
                clearable: false,
                options: [const Option('percent', '%'), Option('flat', export ? 'USD' : 'INR')],
                onChanged: (o) => setS(() => discountType = o?.value ?? discountType),
              ),
            ),
          ]),
        AppSelect<String>(
          label: lump ? 'Quote Conditions (not printed on a Commercial Offer)' : 'Quote Conditions',
          required: !lump,
          value: conditions.isEmpty ? null : conditions,
          options: opts(CrmLists.quoteConditions),
          onChanged: (o) => setS(() => conditions = o?.value ?? ''),
        ),
        if (conditions == 'Other/Custom')
          AppTextField(
              label: 'Custom Quote Conditions', controller: conditionsCustom, maxLines: 2, hint: 'e.g. Prices are ex-works; freight and insurance extra.'),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
              child: AppTextField(
                  label: 'Payment Terms', required: true, controller: paymentText, maxLines: 2, hint: 'Select from Payment Terms list or type your own')),
          rowIconButton(Icons.list_alt_rounded, 'Pick from the Payment Terms list', () => pickPaymentTerm(setS)),
        ]),
        AppTextField(label: 'Notes', controller: notes, maxLines: 2, hint: 'Any additional remarks for this quotation (optional)'),
      ];
    },
    onSave: () async {
      final export = quotationType == 'Export';
      final lump = pricingMode == 'lumpsum';
      final errs = <String>[];
      if (clientName.text.trim().isEmpty) errs.add('Customer/Client is required.');
      if (quoteDate == null) errs.add('Date of Quote is required.');
      final filled = lines.where((l) => !l.isEmpty).toList();
      if (filled.isEmpty) errs.add('Add at least one line item.');
      for (var i = 0; i < filled.length; i++) {
        final l = filled[i];
        final row = 'Line ${i + 1}: ';
        if (l.productId == null) errs.add('${row}Pick the Product — every line is chosen from the Product master.');
        final qn = double.tryParse(l.qty.text);
        if (l.qty.text.trim().isNotEmpty && (qn == null || qn <= 0)) {
          errs.add('${row}Quantity must be more than 0 — enter a positive number or leave it blank.');
        }
        final pn = double.tryParse(l.price.text);
        if (!lump && l.price.text.trim().isNotEmpty && (pn == null || pn < 0)) {
          errs.add('${row}Price/Unit cannot be negative — enter 0 or more, or leave it blank.');
        }
        final gn = double.tryParse(l.gst.text);
        if (!lump && !export && l.gst.text.trim().isNotEmpty && (gn == null || gn < 0 || gn > 100)) {
          errs.add('${row}GST % must be between 0 and 100 — fix it or leave it blank.');
        }
      }
      if (lump) {
        final p = double.tryParse(lumpPrice.text);
        if (p == null || p <= 0) {
          errs.add('Total Price is required for a lump-sum offer — enter the price for the whole offer, or switch Pricing to Item-wise.');
        }
        final g = double.tryParse(lumpGst.text);
        if (!export && lumpGst.text.trim().isNotEmpty && (g == null || g < 0 || g > 100)) errs.add('GST % must be between 0 and 100.');
      }
      if (delivery.text.trim().isEmpty) {
        errs.add('Delivery Time is required.');
      } else if (!_deliveryPattern.hasMatch(delivery.text.trim())) {
        errs.add('Delivery Time: include a unit, e.g. "7 days" or "2 weeks".');
      }
      if (validUntil == null) {
        errs.add('Quote Validity Date is required.');
      } else if (quoteDate != null && isoDate(validUntil).compareTo(isoDate(quoteDate)) < 0) {
        errs.add('Quote Validity Date (${isoDate(validUntil)}) is before the Date of Quote (${isoDate(quoteDate)}). Set it on or after the quote date.');
      }
      final itemsTotal = filled.fold<double>(0, (t, l) => t + l.total(export));
      if (discount.text.trim().isNotEmpty && !lump) {
        final dn = double.tryParse(discount.text);
        if (dn == null || dn < 0) {
          errs.add('Discount cannot be negative. Enter 0 or more, or leave it blank.');
        } else if (discountType == 'percent' && dn > 100) {
          errs.add('Discount is $dn% — a percent discount cannot exceed 100%. Enter 100 or less, or switch the type to a flat amount.');
        } else if (discountType == 'flat' && dn > itemsTotal) {
          errs.add('Flat discount ($dn) is more than the line items total (${itemsTotal.toStringAsFixed(2)}). Reduce the discount.');
        }
      }
      final condValue = conditions == 'Other/Custom' ? conditionsCustom.text.trim() : conditions;
      if (!lump && condValue.isEmpty) errs.add('Quote Conditions is required.');
      if (paymentText.text.trim().isEmpty) errs.add('Payment Terms is required.');
      if (errs.isNotEmpty) throw 'Please fix these before saving the quotation:\n${errs.join('\n')}';

      double? num(String v) => v.trim().isEmpty ? null : double.tryParse(v.trim());
      final payload = <String, dynamic>{
        'quotation_type': quotationType,
        'gst_type': gstType,
        'quote_date': apiDate(quoteDate!),
        'client_name': clientName.text.trim(),
        'client_contact_name': contactName.text.trim(),
        'client_contact_email': contactEmail.text.trim(),
        'client_contact_phone': contactPhone.text.trim(),
        'technical_offer_id': offerId,
        'valid_until': apiDate(validUntil!),
        'delivery_time': delivery.text.trim(),
        'payment_terms': paymentText.text.trim(),
        'notes': notes.text.trim(),
        'pricing_mode': pricingMode,
        'discount': discount.text.trim().isNotEmpty && !lump ? num(discount.text) : null,
        'discount_type': discount.text.trim().isNotEmpty && !lump ? discountType : null,
        'price': lump ? num(lumpPrice.text) : null,
        'lump_sum_gst_percent': lump && !export && lumpGst.text.trim().isNotEmpty ? num(lumpGst.text) : null,
        'quote_conditions': condValue.isEmpty ? null : condValue,
        'items': [
          for (final l in filled)
            <String, dynamic>{
              'product_id': ?l.productId,
              'application_id': ?l.applicationId,
              if (l.description.trim().isNotEmpty) 'description': l.description.trim(),
              if (l.model.text.trim().isNotEmpty) 'model_number': l.model.text.trim(),
              if (l.details.text.trim().isNotEmpty) 'details': l.details.text.trim(),
              'quantity': ?num(l.qty.text),
              if (!lump && num(l.price.text) != null) 'unit_price': num(l.price.text),
              if (!lump && !export && num(l.gst.text) != null) 'gst_percent': num(l.gst.text),
              if (l.subtotal() > 0) 'subtotal': double.parse(l.subtotal().toStringAsFixed(2)),
              if (l.subtotal() > 0) 'total': double.parse(l.total(export).toStringAsFixed(2)),
            },
        ],
      };
      if (editing != null) {
        // A revision sends every field: one left blank is cleared (null).
        for (final k in ['client_contact_name', 'client_contact_email', 'client_contact_phone', 'notes']) {
          if (payload[k] == '') payload[k] = null;
        }
        await guard(() => Api.patch('/crm/inquiries/$inqId/quotations/${editing['id']}', data: payload));
      } else {
        payload.removeWhere((k, v) => v == null || v == '');
        await guard(() => Api.post('/crm/inquiries/$inqId/quotations', data: payload));
      }
    },
  );
}
