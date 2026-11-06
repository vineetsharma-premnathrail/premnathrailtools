import 'package:dio/dio.dart' show MultipartFile;
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';
import 'pr_detail.dart';

// Quotations & Comparison of one RFQ (portal rfq/[id]/comparison): record each
// vendor's quote line by line, compare landed cost, award each line by
// quantity (split allowed), then upload the PO on the requisition.

const _waitStatus = {
  'waiting': ('waiting', 0xFFD97706),
  'overdue': ('overdue', 0xFFDC2626),
  'not_sent': ('email not sent', 0xFF64748B),
};

class ComparisonScreen extends StatefulWidget {
  const ComparisonScreen({super.key, required this.rfqId, this.vendorId});
  final int rfqId;

  /// From "Record quote": open the quote form for this vendor once.
  final int? vendorId;

  @override
  State<ComparisonScreen> createState() => _ComparisonScreenState();
}

class _ComparisonScreenState extends State<ComparisonScreen> {
  Json? _rfq;
  Json? _pr;
  List<Json> _quotes = [];
  Json? _cmp;
  Json? _invites;
  final _files = <int, List<Json>>{};
  final _qtys = <int, TextEditingController>{};
  final _reasons = <int, TextEditingController>{};
  String _error = '';
  bool _busy = false;
  bool _presetDone = false;

  bool get _allowed => P2pAccess.feat('rfq', 'comparison', 'view') && P2pAccess.feat('rfq', 'vendor_quotes', 'view');

  @override
  void initState() {
    super.initState();
    _load();
  }

  TextEditingController _q(int vqi) => _qtys[vqi] ??= TextEditingController();
  TextEditingController _r(int vqi) => _reasons[vqi] ??= TextEditingController();

  void _seed(Json c) {
    for (final t in _qtys.values) {
      t.text = '';
    }
    for (final l in jList(c, 'lines')) {
      final cells = asList(l['quotes']);
      final saved = cells.where((x) => jD(x, 'awarded_qty') > 1e-6).toList();
      for (final x in saved) {
        final vqi = jInt(x, 'vendor_quotation_item_id')!;
        _q(vqi).text = qtyText(jD(x, 'awarded_qty'));
        if (jStr(x, 'award_reason') != null && _r(vqi).text.isEmpty) _r(vqi).text = jStr(x, 'award_reason')!;
      }
      final l1 = jInt(l, 'l1_vendor_quotation_item_id');
      final open = toDouble(l['open_qty']) ?? jD(l, 'quantity');
      if (saved.isEmpty && l1 != null && open > 1e-6) {
        final cell = cells.where((x) => jInt(x, 'vendor_quotation_item_id') == l1).firstOrNull;
        final can = toDouble(cell?['quote_quantity']) ?? jD(l, 'quantity');
        _q(l1).text = qtyText(can < open ? can : open);
      }
    }
  }

  Future<void> _load() async {
    if (!_allowed) {
      setState(() => _error =
          "Your role doesn't include R.F.Q › Quotation comparison and Vendor quotations (view), so this page can't be shown. Ask an admin to add them to your role (Organization › Roles).");
      return;
    }
    try {
      final r = asJson(await Api.get('/p2p/rfqs/${widget.rfqId}'));
      final res = await Future.wait([
        Api.get('/p2p/requests/${r['p2p_request_id']}'),
        Api.get('/p2p/rfqs/${widget.rfqId}/line-quotations'),
        Api.get('/p2p/rfqs/${widget.rfqId}/comparison'),
      ]);
      final problems = <String>[];
      Json? inv;
      try {
        inv = asJson(await Api.get('/p2p/rfqs/${widget.rfqId}/invites'));
      } catch (e) {
        problems.add('Could not load the vendors this RFQ was emailed to: ${ApiClient.describe(e)}');
      }
      final quotes = asList(res[1]);
      for (final vq in quotes) {
        try {
          _files[jInt(vq, 'id')!] = asList(await Api.get('/p2p/rfqs/${widget.rfqId}/line-quotations/${vq['id']}/files'));
        } catch (e) {
          problems.add('${vq['vendor_name']}: could not load the quotation files — ${ApiClient.describe(e)}');
        }
      }
      if (!mounted) return;
      final c = asJson(res[2]);
      setState(() {
        _rfq = r;
        _pr = asJson(res[0]);
        _quotes = quotes;
        _cmp = c;
        _invites = inv;
        _error = problems.join(' ');
        _seed(c);
      });
      if (!_presetDone && widget.vendorId != null) {
        _presetDone = true;
        if (!quotes.any((q) => jInt(q, 'vendor_id') == widget.vendorId)) _quoteForm(null, presetVendor: widget.vendorId);
      }
    } catch (e) {
      if (mounted) setState(() => _error = '${ApiClient.describe(e)} Go back to the RFQ and open it again.');
    }
  }

  double _want(Json c) => (double.tryParse(_q(jInt(c, 'vendor_quotation_item_id')!).text) ?? 0).clamp(0, double.infinity).toDouble();
  List<Json> _cells(Json l) => asList(l['quotes']);
  bool _changed(Json l) => _cells(l).any((c) => (_want(c) - jD(c, 'awarded_qty')).abs() > 1e-6);

  Future<void> _saveAwards() async {
    final awards = <Map<String, dynamic>>[];
    for (final l in jList(_cmp, 'lines').where(_changed)) {
      for (final c in _cells(l)) {
        final want = _want(c);
        final vqi = jInt(c, 'vendor_quotation_item_id')!;
        if (want > 1e-6) {
          awards.add({
            'pr_item_id': l['pr_item_id'],
            'vendor_quotation_item_id': vqi,
            'quantity': want,
            if (_r(vqi).text.trim().isNotEmpty) 'reason': _r(vqi).text.trim(),
          });
        } else if (jD(c, 'awarded_qty') > 1e-6) {
          awards.add({'pr_item_id': l['pr_item_id'], 'vendor_quotation_item_id': vqi, 'quantity': 0});
        }
      }
    }
    if (awards.isEmpty) {
      showSnack(context, 'Nothing to save: enter a quantity for at least one vendor on a line, or change an award first.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final fresh = asJson(await Api.post('/p2p/rfqs/${widget.rfqId}/awards', data: {'awards': awards}));
      if (mounted) {
        setState(() {
          _cmp = fresh;
          _seed(fresh);
        });
        showSnack(context, 'Awards saved.');
      }
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _attach(Json q) async {
    final files = await Files.pickFiles();
    if (files.isEmpty || !mounted) return;
    final ok = await runAction(context, () async {
      await Api.post('/p2p/rfqs/${widget.rfqId}/line-quotations/${q['id']}/files', data: formData({'files': files}));
    }, success: 'Quotation file attached.');
    if (ok) _load();
  }

  Future<void> _quoteForm(Json? quote, {int? presetVendor}) async {
    final rfq = _rfq!;
    final pr = _pr!;
    final vendors = await withLoading(context, loadActiveVendors);
    if (vendors == null || !mounted) return;
    final rfqLines = jList(rfq, 'items').where((i) => i['withdrawn_at'] == null).toList();
    final ask = rfqLines.isNotEmpty
        ? [
            for (final i in rfqLines)
              (id: jInt(i, 'pr_item_id')!, code: jStr(i, 'item_code'), name: jStr(i, 'item_name') ?? 'Item', unit: jStr(i, 'unit'), ask: jD(i, 'quantity')),
          ]
        : [
            for (final i in jList(pr, 'items').where((i) => jStr(i, 'fulfillment_status') != 'stock_issued'))
              (
                id: jInt(i, 'id')!,
                code: jStr(i, 'item_code'),
                name: jStr(i, 'item_name') ?? 'Item',
                unit: jStr(i, 'unit'),
                ask: jD(i, 'quantity') - jD(i, 'issued_qty'),
              ),
          ];
    int? vendorId = jInt(quote, 'vendor_id') ?? presetVendor;
    final ref = TextEditingController(text: jStr(quote, 'quote_ref') ?? '');
    DateTime? valid = parseDate(quote?['valid_until']);
    final freight = TextEditingController(text: quote?['freight_total'] != null ? '${quote!['freight_total']}' : '');
    final packing = TextEditingController(text: quote?['packing_total'] != null ? '${quote!['packing_total']}' : '');
    final pay = TextEditingController(text: jStr(quote, 'payment_terms') ?? '');
    final ctl = <int, Map<String, TextEditingController>>{};
    for (final a in ask) {
      final qi = jList(quote, 'items').where((x) => jInt(x, 'pr_item_id') == a.id).firstOrNull;
      final qq = toDouble(qi?['quantity']);
      ctl[a.id] = {
        'price': TextEditingController(text: qi != null ? '${qi['unit_price']}' : ''),
        'disc': TextEditingController(text: qi?['discount_pct'] != null ? '${qi!['discount_pct']}' : ''),
        'gst': TextEditingController(text: qi?['gst_rate'] != null ? '${qi!['gst_rate']}' : '18'),
        'days': TextEditingController(text: qi?['delivery_days'] != null ? '${qi!['delivery_days']}' : ''),
        'make': TextEditingController(text: jStr(qi, 'make_offered') ?? ''),
        'supply': TextEditingController(text: qq != null && qq + 1e-6 < a.ask ? qtyText(qq) : ''),
      };
    }
    final files = <MultipartFile>[];
    String? warning;
    final ok = await showFormSheet(
      context,
      title: quote != null ? "Edit ${quote['vendor_name']}'s quote" : 'Record a vendor quote',
      saveLabel: 'Save quote',
      builder: (ctx, setS) => [
        Hint('${rfq['rfq_number']} · price each line the vendor quoted — leave a line blank if it was not quoted.'),
        const FormHeading('Vendor & Terms'),
        AppSelect<int>(
          label: 'Vendor',
          required: true,
          value: vendorId,
          options: [for (final v in vendors) Option(jInt(v, 'id')!, '${v['name']}${jStr(v, 'code') != null ? ' (${v['code']})' : ''}')],
          onChanged: (o) => setS(() => vendorId = o?.value),
        ),
        AppTextField(label: 'Quote ref.', controller: ref),
        DateField(label: 'Valid until', value: valid, onChanged: (d) => setS(() => valid = d)),
        AppTextField(label: 'Freight', controller: freight, keyboardType: AppTextField.number),
        AppTextField(label: 'Packing', controller: packing, keyboardType: AppTextField.number),
        AppTextField(label: 'Payment terms', controller: pay),
        const FormHeading('Line prices'),
        for (final a in ask)
          InnerCard(children: [
            Text('${a.code != null ? '${a.code} · ' : ''}${a.name}', style: const TextStyle(fontWeight: FontWeight.w600)),
            Hint('Asked: ${fmtQty(a.ask)} ${a.unit ?? ''}'),
            const SizedBox(height: 8),
            AppTextField(label: 'Can supply', controller: ctl[a.id]!['supply'], keyboardType: AppTextField.number, hint: fmtQty(a.ask)),
            const SizedBox(height: 8),
            AppTextField(label: 'Unit price', controller: ctl[a.id]!['price'], keyboardType: AppTextField.number),
            const SizedBox(height: 8),
            AppTextField(label: 'Disc. %', controller: ctl[a.id]!['disc'], keyboardType: AppTextField.number),
            const SizedBox(height: 8),
            AppTextField(label: 'GST %', controller: ctl[a.id]!['gst'], keyboardType: AppTextField.number),
            const SizedBox(height: 8),
            AppTextField(label: 'Delivery (days)', controller: ctl[a.id]!['days'], keyboardType: TextInputType.number),
            const SizedBox(height: 8),
            AppTextField(label: 'Make offered', controller: ctl[a.id]!['make']),
          ]),
        const Hint('Prices excl. GST. Landed cost on the comparison adds freight and packing, spread over the quoted lines. Leave "Can supply" empty '
            'when the vendor quotes the full quantity asked; enter less when they can only supply part (the rest can be awarded to another vendor).'),
        const FormHeading("Vendor's quotation (PDF)"),
        Row(children: [
          Expanded(child: Text(files.isEmpty ? 'No file picked' : files.map((f) => f.filename).join(', '))),
          secondaryBtn('Attach', () async {
            final picked = await Files.pickFiles();
            files.addAll(picked);
            try {
              setS(() {});
            } catch (_) {}
          }, icon: Icons.attach_file_rounded),
        ]),
        Hint('Attach the quotation the vendor emailed back${quote != null ? ' (added to the files already on this quote)' : ''} — '
            'it is kept with the quote as proof of the rates.'),
      ],
      onSave: () async {
        if (vendorId == null) throw 'Pick the vendor from the vendor master.';
        for (final a in ask) {
          final c = ctl[a.id]!;
          final cs = c['supply']!.text.trim();
          if ((double.tryParse(c['price']!.text) ?? 0) > 0 && cs.isNotEmpty) {
            final n = double.tryParse(cs);
            if (n == null || n <= 0) {
              throw '${a.name}: "Can supply" must be more than 0. Leave it empty if the vendor quotes the full ${fmtQty(a.ask)} ${a.unit ?? ''}.';
            }
            if (n - a.ask > 1e-6) {
              throw '${a.name}: this RFQ asks for ${fmtQty(a.ask)} ${a.unit ?? ''}, so "Can supply" can be at most that. Enter ${fmtQty(a.ask)} or less.';
            }
          }
        }
        double? n(TextEditingController t) => t.text.trim().isEmpty ? null : double.tryParse(t.text.trim());
        final items = [
          for (final a in ask)
            if ((double.tryParse(ctl[a.id]!['price']!.text) ?? 0) > 0)
              {
                'pr_item_id': a.id,
                'unit_price': double.parse(ctl[a.id]!['price']!.text),
                'quantity': n(ctl[a.id]!['supply']!),
                'discount_pct': n(ctl[a.id]!['disc']!),
                'gst_rate': n(ctl[a.id]!['gst']!),
                'delivery_days': n(ctl[a.id]!['days']!)?.toInt(),
                'make_offered': ctl[a.id]!['make']!.text.trim().isEmpty ? null : ctl[a.id]!['make']!.text.trim(),
              },
        ];
        if (items.isEmpty) throw 'Enter a unit price for at least one line the vendor quoted (leave a line blank if not quoted).';
        final payload = {
          'vendor_id': vendorId,
          'quote_ref': ref.text.trim().isEmpty ? null : ref.text.trim(),
          'valid_until': valid == null ? null : apiDate(valid!),
          'freight_total': n(freight),
          'packing_total': n(packing),
          'payment_terms': pay.text.trim().isEmpty ? null : pay.text.trim(),
          'items': items,
        };
        final vq = asJson(quote != null
            ? await Api.put('/p2p/rfqs/${widget.rfqId}/line-quotations/${quote['id']}', data: payload)
            : await Api.post('/p2p/rfqs/${widget.rfqId}/line-quotations', data: payload));
        if (files.isNotEmpty) {
          try {
            await Api.post('/p2p/rfqs/${widget.rfqId}/line-quotations/${vq['id']}/files', data: formData({'files': files}));
          } catch (e) {
            warning = "Quote saved, but the PDF didn't upload: ${ApiClient.describe(e)} Attach it again from the quote.";
          }
        }
      },
    );
    if (ok) {
      await _load();
      if (warning != null && mounted) showSnack(context, warning!, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cmp = _cmp;
    final rfq = _rfq;
    final pr = _pr;
    final canEdit = P2pAccess.can('rfq', 'edit');
    final canRecord = canEdit && P2pAccess.feat('rfq', 'vendor_quotes', 'create');
    final canAward = canEdit && P2pAccess.feat('rfq', 'award', 'edit');
    final canExport = P2pAccess.can('rfq', 'export') &&
        P2pAccess.feat('rfq', 'comparison', 'export') &&
        (canEdit || P2pAccess.feat('rfq', 'prices', 'view'));
    final canAttach = canEdit && (P2pAccess.feat('rfq', 'vendor_quotes', 'edit') || P2pAccess.feat('rfq', 'vendor_quotes', 'create'));
    final inviteList = jList(_invites, 'invites');
    final waiting = inviteList.where((i) => jStr(i, 'quote_status') != 'quoted').toList();
    final lines = jList(cmp, 'lines');
    final vendors = jList(cmp, 'vendors');
    final awardedLines = lines.where((l) => jD(l, 'awarded_total') > 1e-6).length;
    final unsaved = lines.any(_changed);

    return SubPage(
      title: 'Quotations & Comparison',
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (pr != null)
                Text('${pr['p2p_number']}${rfq != null ? ' · ${rfq['rfq_number']}' : ''}',
                    style: const TextStyle(color: Brand.primary, fontWeight: FontWeight.w600, fontSize: 12)),
              const Hint('Price every line per vendor, compare landed cost, then award each line by quantity (a line can be split between vendors). '
                  'The PO per vendor is uploaded on the requisition.'),
            ]),
          ),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: NoteBox(_error, tone: NoteTone.error)),
          if (cmp == null && _error.isEmpty) const LoadingView(),
          if (cmp != null && rfq != null && pr != null) ...[
            DetailSection('1. Vendor quotes', action: canRecord ? primaryBtn('+ Record a quote', () => _quoteForm(null)) : null, children: [
              if (inviteList.isNotEmpty) ...[
                Text('Quotes recorded: ${inviteList.length - waiting.length} of ${inviteList.length} invited vendors · '
                    'quote by ${fmtDate(_invites?['quote_due_date'])}'),
                if (waiting.isNotEmpty)
                  Wrap(spacing: 6, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    const Text('Still waiting:'),
                    for (final w in waiting)
                      Builder(builder: (_) {
                        final s = _waitStatus[jStr(w, 'quote_status')] ?? (jStr(w, 'quote_status') ?? '', 0xFF64748B);
                        return canRecord
                            ? linkBtn('${w['vendor_name']} (${s.$1})', () => _quoteForm(null, presetVendor: jInt(w, 'vendor_id')))
                            : Text('${w['vendor_name']} (${s.$1})', style: TextStyle(color: Color(s.$2)));
                      }),
                  ]),
                const SizedBox(height: 8),
              ],
              if (_quotes.isEmpty) const Text("No line-level quotes yet. Record each vendor's quote — the vendor is picked from the vendor master."),
              for (final q in _quotes)
                InnerCard(children: [
                  Text('${q['vendor_name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  Hint('${jStr(q, 'quote_ref') ?? 'no ref'} · ${jList(q, 'items').length} line(s) · ${money(q['quoted_price'])} excl. GST'
                      '${q['valid_until'] != null ? ' · valid till ${fmtDate(q['valid_until'])}' : ''}'),
                  for (final f in _files[jInt(q, 'id')] ?? const <Json>[])
                    linkBtn('${f['filename']}', () => openApiFile(context, '/p2p/rfqs/${widget.rfqId}/attachments/${f['id']}/content', '${f['filename']}')),
                  Wrap(spacing: 12, children: [
                    if (canEdit && P2pAccess.feat('rfq', 'vendor_quotes', 'edit')) linkBtn('Edit', () => _quoteForm(q)),
                    if (canAttach) linkBtn((_files[jInt(q, 'id')] ?? const []).isNotEmpty ? 'Attach another file' : 'Attach PDF', () => _attach(q)),
                  ]),
                ]),
            ]),
            DetailSection('2. Comparison & award',
                action: canExport
                    ? secondaryBtn('Export Excel', () => openApiFile(context, '/p2p/rfqs/${widget.rfqId}/comparison/export', '${rfq['rfq_number']}_comparison.xlsx'))
                    : null,
                children: [
                  Hint('${jStr(cmp, 'basis') ?? ''} Best of lines total: ${money(cmp['best_of_lines_total'])}'),
                  const SizedBox(height: 8),
                  for (final v in vendors)
                    Hint('${v['vendor_name']}${jStr(v, 'overall_rank') != null ? ' (${v['overall_rank']})' : ''}: total landed (excl. GST) ${money(v['landed_total'])}'
                        '${v['complete'] == true ? '' : ' · ${v['lines_quoted']}/${lines.length} lines'}'
                        '${v['eligible'] == false ? ' · ${v['ineligible_reason'] ?? 'not eligible'}' : ''}'),
                  const SizedBox(height: 8),
                  for (final l in lines) _lineCard(l, vendors, canAward),
                  if (canAward && lines.isNotEmpty) primaryBtn(_busy ? 'Saving…' : 'Save awards', _busy || !unsaved ? null : _saveAwards),
                ]),
            DetailSection('3. Upload the PO', children: [
              if (awardedLines == 0)
                const Text('Award the lines (L1 is filled in as a starting point) and save. Then make a PO in Tally for each awarded vendor and upload it on the requisition.')
              else ...[
                Text('$awardedLines line(s) awarded. Make a PO in Tally for each awarded vendor, then upload each on the requisition (Upload PO). '
                    'Each PO goes for approval on its own.'),
                if (unsaved)
                  const Hint('You have changed the award quantities. Tap Save awards first, so the saved awards are what the PO follows.',
                      color: Color(0xFFB45309)),
                const SizedBox(height: 8),
                if (P2pAccess.can('purchase_orders', 'create'))
                  primaryBtn('Open requisition to upload PO →',
                      unsaved || _busy ? null : () => openScreen(context, PrDetailScreen(prId: jInt(pr, 'id')!)))
                else
                  const Hint('The purchase team uploads the Tally PO on the requisition — that needs Create access on Procurement › Purchase Orders.'),
              ],
            ]),
          ],
        ]),
      ),
    );
  }

  Widget _lineCard(Json l, List<Json> vendors, bool canAward) {
    final qty = jD(l, 'quantity');
    final open = toDouble(l['open_qty']);
    final total = _cells(l).fold<double>(0, (s, c) => s + _want(c));
    final over = total - qty > 1e-6;
    final full = !over && (total - qty).abs() <= 1e-6;
    final color = over ? const Color(0xFFB91C1C) : (full ? const Color(0xFF166534) : const Color(0xFF92400E));
    final l1 = jInt(l, 'l1_vendor_quotation_item_id');
    final lastPo = l['last_po'] is Map ? asJson(l['last_po']) : null;
    final quotes = _cells(l);
    final cellsRaw = l['quotes'] is List ? l['quotes'] as List : const [];
    return InnerCard(children: [
      Text('${jStr(l, 'item_code') != null ? '${l['item_code']} · ' : ''}${l['item_name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
      Hint('To buy ${fmtQty(qty)} ${jStr(l, 'unit') ?? ''}${open != null && open + 1e-6 < qty ? ' · ${fmtQty(open)} not yet ordered' : ''}'
          ' · Last PO ${lastPo != null ? '${money(lastPo['unit_price'])} (${lastPo['vendor_name']})' : '—'}'),
      const SizedBox(height: 6),
      for (var i = 0; i < cellsRaw.length && i < vendors.length; i++) _cell(cellsRaw[i], vendors[i], quotes, qty, open, l1, canAward),
      Text('Awarded ${fmtQty(total)} / To buy ${fmtQty(qty)} ${jStr(l, 'unit') ?? ''}', style: TextStyle(fontWeight: FontWeight.w700, color: color)),
      if (over) Hint('${fmtQty(total - qty)} too much: reduce an award.', color: const Color(0xFFB91C1C)),
      if (!over && !full && total > 1e-6) Hint('${fmtQty(qty - total)} still without a vendor', color: const Color(0xFF92400E)),
      if (_changed(l)) const Hint('not saved yet', color: Color(0xFFB45309)),
    ]);
  }

  Widget _cell(Object? raw, Json v, List<Json> quotes, double qty, double? open, int? l1, bool canAward) {
    if (raw is! Map) {
      return Padding(padding: const EdgeInsets.only(bottom: 6), child: Hint('${v['vendor_name']}: not quoted'));
    }
    final c = asJson(raw);
    final vqi = jInt(c, 'vendor_quotation_item_id')!;
    final rank = jStr(c, 'rank');
    final can = toDouble(c['quote_quantity']);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: rank == 'L1' ? const Color(0x1216A34A) : Brand.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Brand.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${v['vendor_name']}', style: const TextStyle(fontWeight: FontWeight.w600))),
          if (rank != null) Text(rank, style: TextStyle(fontWeight: FontWeight.w800, color: rank == 'L1' ? const Color(0xFF16A34A) : Brand.muted)),
        ]),
        Text('${money(c['landed_unit'])} landed', style: const TextStyle(fontWeight: FontWeight.w700)),
        Hint('rate ${money(c['unit_price'])}${jD(c, 'discount_pct') > 0 ? ' −${c['discount_pct']}%' : ''} · GST ${c['gst_rate'] ?? 0}%'
            '${c['delivery_days'] != null ? ' · ${c['delivery_days']} d' : ''}'),
        if (can != null && can + 1e-6 < qty) Hint('can supply ${fmtQty(can)} of ${fmtQty(qty)}', color: const Color(0xFF92400E)),
        if (jD(c, 'awarded_qty') > 1e-6) Hint('awarded ${fmtQty(c['awarded_qty'])}', color: const Color(0xFF2563EB)),
        if (canAward && c['eligible'] != false) ...[
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: AppTextField(label: 'Award qty', controller: _q(vqi), keyboardType: AppTextField.number, onChanged: (_) => setState(() {}))),
            const SizedBox(width: 8),
            secondaryBtn('All', () => setState(() {
                  for (final o in quotes) {
                    _q(jInt(o, 'vendor_quotation_item_id')!).text = '';
                  }
                  final cap = can ?? qty;
                  final op = open ?? qty;
                  _q(vqi).text = qtyText(cap < op ? cap : op);
                })),
          ]),
          if (_want(c) > 1e-6 && vqi != l1) ...[
            const SizedBox(height: 6),
            AppTextField(label: 'Why ${v['vendor_name']} (${rank ?? 'not L1'}), not L1? *', controller: _r(vqi)),
          ],
        ],
      ]),
    );
  }
}