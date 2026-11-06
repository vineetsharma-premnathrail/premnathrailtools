import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';
import 'quality_lots.dart';

/// First Article Inspection (portal first-articles/page.tsx, new, [id]).

const _statusLabels = <String, String>{'open': 'Open', 'approved': 'Approved', 'rejected': 'Rejected', 'cancelled': 'Cancelled'};
const _statusHex = <String, Color>{
  'open': Color(0xFFF59E0B),
  'approved': Color(0xFF16A34A),
  'rejected': Color(0xFFDC2626),
  'cancelled': Color(0xFFA8A29E),
};
const _triggerLabels = <String, String>{
  'new_item': 'New item',
  'new_revision': 'New drawing revision',
  'new_vendor': 'New vendor',
  'manual': 'Manual',
};

class FirstArticlesTab extends StatefulWidget {
  const FirstArticlesTab({super.key});

  @override
  State<FirstArticlesTab> createState() => _FirstArticlesTabState();
}

class _FirstArticlesTabState extends State<FirstArticlesTab> {
  String _status = '';
  final _listKey = GlobalKey<ApiListViewState>();

  Future<void> _new() async {
    final f = await _showNewFaiForm(context);
    if (f != null && mounted) {
      _listKey.currentState?.reload();
      openScreen(context, FirstArticleDetailScreen(id: asInt(f['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton:
          Perm.can('quality', 'first_article', 'create') ? CreateFab(label: 'New FAI', onPressed: _new) : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search FAI, item, vendor, GRN / WO…',
        load: (page, search) => Api.list('/quality/first-articles', query: {'status': _status, 'search': search}),
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('First Article Inspection', subtitle: 'Quality Module'),
          const Hint('Rule 9: a new item, a new drawing revision or a new vendor gets a full-drawing first article check. '
              'The first GRN / job work receipt / production output of it becomes the FAI lot automatically; regular lots '
              'of that item and source can\'t be accepted until a Quality engineer approves the FAI.'),
          FilterSelect(
            label: 'Status',
            allLabel: 'All statuses',
            value: _status,
            options: _statusLabels,
            onChanged: (v) {
              setState(() => _status = v);
              _listKey.currentState?.reload();
            },
          ),
        ]),
        emptyText: 'No first article inspections found — they are raised automatically for new items, revisions and '
            'vendors, or use + New FAI.',
        itemBuilder: (ctx, f, reload) => RecordCard(
          code: str(f['fai_number']),
          title: codeName(f['item_code'], f['item_name']),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: qPill(_statusLabels, _statusHex, f['status'])),
          meta: [
            (
              'Source',
              '${str(f['vendor_name']).isEmpty ? 'In-house' : f['vendor_name']}'
                  '${str(f['source_reference']).isNotEmpty ? ' · ${f['source_reference']}' : ''}'
            ),
            ('Drawing', txt(f['drawing_ref'])),
            ('Why', lbl(_triggerLabels, f['trigger'])),
            (
              'Lot',
              '${txt(f['lot_number'])}${f['lot_status'] != null ? ' · ${lbl(lotStatusLabels, f['lot_status'])}' : ''}'
            ),
            ('Decided', str(f['decided_by_name']).isNotEmpty ? '${f['decided_by_name']}, ${fmtDate(f['decided_at'])}' : '—'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => FirstArticleDetailScreen(id: asInt(f['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

// ── New FAI (first-articles/new/page.tsx) ────────────────────────────────────

const _reqTriggerLabels = <String, String>{
  'new_item': 'new item',
  'new_revision': 'new drawing revision',
  'new_vendor': 'new vendor',
};

Future<Json?> _showNewFaiForm(BuildContext context) async {
  List<Option<int>> locations = [];
  try {
    locations = [
      for (final l in rowsOf(await Api.get('/quality/masters/locations')))
        Option(asInt(l['id'])!, '${txt(l['code'])} — ${txt(l['name'])}'),
    ];
  } catch (_) {}
  if (!context.mounted) return null;
  int? itemId;
  String? itemLabel;
  String? itemUom;
  final vendor = TextEditingController();
  final qty = TextEditingController(text: '1');
  var hold = false;
  int? locationId;
  final ref = TextEditingController();
  final remarks = TextEditingController();
  Json? req;
  var reqKey = '';
  Json? created;

  Future<void> checkReq(StateSetter setS) async {
    if (itemId == null) {
      setS(() => req = null);
      return;
    }
    final key = '$itemId|${vendor.text.trim()}';
    reqKey = key;
    try {
      final r = await Api.get('/quality/first-articles/requirement',
          query: {'item_id': itemId, 'vendor_name': vendor.text.trim()});
      if (reqKey == key) setS(() => req = r is Map ? Map<String, dynamic>.from(r) : null);
    } catch (_) {
      if (reqKey == key) setS(() => req = null);
    }
  }

  String reqText(Json r) {
    final b = StringBuffer();
    if (r['applies'] != true) {
      b.write('This item is not inspection-controlled, so rule 9 does not require an FAI — you can still raise one. ');
    } else if (r['released'] == true) {
      b.write('Already released for regular lots from this source. ');
    } else {
      b.write('FAI required: ${_reqTriggerLabels[str(r['trigger'])] ?? str(r['trigger'])}. ');
    }
    b.write(str(r['drawing_ref']).isNotEmpty ? 'Current drawing: ${r['drawing_ref']}.' : 'No released drawing linked in Design.');
    if (str(r['open_fai']).isNotEmpty) b.write(' ${r['open_fai']} is already open for it.');
    return b.toString();
  }

  final ok = await showFormSheet(
    context,
    title: 'New First Article Inspection',
    saveLabel: 'Raise FAI',
    builder: (ctx, setS) => [
      const Text(
          'For a sample sent ahead of the order or an item that needs re-qualification. Receipts of a new item / revision / '
          'vendor raise their FAI automatically.',
          style: TextStyle(fontSize: 13, color: Brand.muted)),
      const Caps('First article'),
      AppSelect<int>(
        label: 'Item',
        required: true,
        value: itemId,
        valueLabel: itemLabel,
        loadOptions: loadQualityItems,
        onChanged: (o) {
          setS(() {
            itemId = o?.value;
            itemLabel = o?.label;
            itemUom = o?.subtitle;
          });
          checkReq(setS);
        },
      ),
      Focus(
        onFocusChange: (has) {
          if (!has) checkReq(setS);
        },
        child: AppTextField(label: 'Vendor', controller: vendor, hint: 'Empty = made in-house'),
      ),
      AppTextField(
          label: 'Pieces${itemUom != null ? ' ($itemUom)' : ''}',
          required: true,
          controller: qty,
          keyboardType: AppTextField.number),
      if (req != null)
        Text(reqText(req!),
            style: TextStyle(fontSize: 13, color: req!['released'] == true ? qGreen : const Color(0xFFB45309))),
      AppTextField(label: 'Reference document', controller: ref, hint: 'e.g. sample challan no.'),
      const Caps('Stock'),
      CheckField(
        label: 'Hold stock — the pieces are in a store\'s Free stock; move them to Quality stock until the decision',
        value: hold,
        onChanged: (v) => setS(() => hold = v),
      ),
      if (hold)
        AppSelect<int>(
          label: 'Store',
          required: true,
          value: locationId,
          options: locations,
          onChanged: (o) => setS(() => locationId = o?.value),
        ),
      const Text('Leave unticked when the sample isn\'t in stock yet (e.g. sent by the vendor ahead of the order).',
          style: TextStyle(fontSize: 12, color: Brand.muted)),
      const Caps('Remarks'),
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
    ],
    onSave: () async {
      if (itemId == null) throw 'Pick the item.';
      final q = num.tryParse(qty.text.trim());
      if (q == null || q <= 0) throw 'Enter how many first-article pieces are being checked.';
      if (hold && locationId == null) {
        throw 'Pick the store whose Free stock holds the first article — or untick "Hold stock".';
      }
      final r = await Api.post('/quality/first-articles', data: {
        'item_id': itemId,
        'vendor_name': vendor.text.trim().isEmpty ? null : vendor.text.trim(),
        'quantity': q,
        'take_from_free': hold,
        'location_id': hold ? locationId : null,
        'source_reference': ref.text.trim().isEmpty ? null : ref.text.trim(),
        'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
      });
      created = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? created : null;
}

// ── FAI detail (first-articles/[id]/page.tsx) ────────────────────────────────

const _detailTriggerLabels = <String, String>{
  'new_item': 'New item',
  'new_revision': 'New drawing revision',
  'new_vendor': 'New vendor',
  'manual': 'Raised manually',
};

class FirstArticleDetailScreen extends StatefulWidget {
  const FirstArticleDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<FirstArticleDetailScreen> createState() => _FirstArticleDetailScreenState();
}

class _FirstArticleDetailScreenState extends State<FirstArticleDetailScreen> {
  Json? _fai;
  Object? _error;

  bool get _canApprove =>
      Perm.can('quality', 'first_article', 'approve') && Perm.canFeature('quality', 'first_article', 'decision', 'approve');
  bool get _canReject =>
      Perm.can('quality', 'first_article', 'approve') && Perm.canFeature('quality', 'first_article', 'decision', 'reject');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get('/quality/first-articles/${widget.id}');
      if (mounted) {
        setState(() {
          _fai = Map<String, dynamic>.from(r as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _decide(bool approve) async {
    final fai = _fai!;
    final remarks = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: approve ? 'Approve first article' : 'Reject first article',
      saveLabel: approve ? 'Approve FAI' : 'Reject FAI',
      builder: (ctx, setS) => [
        Text('${txt(fai['fai_number'])} · ${txt(fai['item_name'])}', style: const TextStyle(color: Brand.muted)),
        AppTextField(
          label: 'Remarks',
          required: !approve,
          controller: remarks,
          maxLines: 4,
          hint: approve ? 'Required when the lot was accepted with a deviation' : 'What failed on the full drawing check',
        ),
        Text(
            approve
                ? '${txt(fai['item_name'])} (${str(fai['vendor_name']).isEmpty ? 'in-house' : fai['vendor_name']}'
                    '${str(fai['drawing_ref']).isNotEmpty ? ', ${fai['drawing_ref']}' : ''}) will be released for regular lots. This can\'t be undone.'
                : 'The next receipt / production run of this item and source becomes a fresh first article. This can\'t be undone.',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        final r = await Api.post('/quality/first-articles/${widget.id}/decision',
            data: {'approve': approve, 'remarks': remarks.text});
        if (r is Map && mounted) setState(() => _fai = Map<String, dynamic>.from(r));
      },
    );
    if (ok && mounted) showSnack(context, approve ? 'First article approved.' : 'First article rejected.');
  }

  @override
  Widget build(BuildContext context) {
    final fai = _fai;
    if (fai == null) {
      return SubPage(title: 'First Article', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final status = str(fai['status']);
    final vendor = str(fai['vendor_name']);
    final revChanged = status == 'approved' && str(fai['current_drawing_ref']) != str(fai['drawing_ref']);
    final canDecide = _canApprove || _canReject;
    return SubPage(
      title: txt(fai['fai_number']),
      bottom: status == 'open' && canDecide
          ? BottomActions(children: [
              if (_canReject) secondaryBtn('Reject FAI', () => _decide(false), color: qRed, icon: Icons.close_rounded),
              if (_canApprove) primaryBtn('Approve FAI', () => _decide(true), color: qGreen),
            ])
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            const Hint('Quality · First article inspection'),
            DetailSection(codeName(fai['item_code'], fai['item_name']), children: [
              Text(
                  'First piece from ${vendor.isEmpty ? 'in-house production' : vendor} checked against the full drawing before '
                  'regular lots are allowed. Reason: ${lbl(_detailTriggerLabels, fai['trigger']).toLowerCase()}.',
                  style: const TextStyle(fontSize: 13.5)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                qPill(_statusLabels, _statusHex, status),
                Text('Raised ${fmtDate(fai['created_at'])} by ${str(fai['created_by_name']).isEmpty ? 'System' : fai['created_by_name']}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ]),
            DetailSection('What is checked', children: [
              FieldRow('Source', vendor.isEmpty ? 'In-house production' : vendor),
              FieldRow('Drawing revision', str(fai['drawing_ref']).isEmpty ? 'No released drawing in Design' : fai['drawing_ref']),
              FieldRow('Raised from', str(fai['source_reference']).isNotEmpty ? fai['source_reference'] : fai['source_type']),
              if (revChanged)
                Text(
                    'The item\'s released drawing is now ${str(fai['current_drawing_ref']).isEmpty ? 'none' : fai['current_drawing_ref']} — '
                    'this approval covered ${str(fai['drawing_ref']).isEmpty ? 'no drawing' : fai['drawing_ref']}, so the next receipt needs a new FAI.',
                    style: const TextStyle(fontSize: 13, color: Color(0xFFB45309))),
            ]),
            DetailSection('Full drawing check (lot)', children: [
              FieldRow(
                'Inspection lot',
                fai['lot_id'] == null
                    ? 'No lot'
                    : Wrap(spacing: 10, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                        InkWell(
                          onTap: () => openScreen(context, LotDetailScreen(id: asInt(fai['lot_id'])!)),
                          child: Text(txt(fai['lot_number']),
                              style: const TextStyle(color: qAccent, fontWeight: FontWeight.w700)),
                        ),
                        Text(lbl(lotStatusLabels, fai['lot_status']), style: const TextStyle(fontSize: 13)),
                        if (fai['lot_decision'] != null)
                          Text('Decision: ${lbl(decisionLabels, fai['lot_decision'])}',
                              style: const TextStyle(fontSize: 13, color: Brand.muted)),
                      ]),
              ),
              const Text(
                  'The lot checks every characteristic of the item\'s First article plan — or, without one, its incoming / final '
                  'plan on the first-article sample (Quality → Settings), accept 0.',
                  style: TextStyle(fontSize: 12.5, color: Brand.muted)),
            ]),
            DetailSection('Decision', children: [
              if (status == 'open') ...[
                if (!canDecide)
                  const Text('Waiting for a Quality engineer to approve or reject this first article.',
                      style: TextStyle(fontSize: 13, color: Brand.muted))
                else
                  const Text('Approve or reject with the buttons below.', style: TextStyle(fontSize: 13, color: Brand.muted)),
              ] else ...[
                FieldRow('Status', lbl(_statusLabels, status)),
                FieldRow('Decided by', '${txt(fai['decided_by_name'])} · ${fmtDate(fai['decided_at'])}'),
                if (str(fai['decision_remarks']).isNotEmpty) FieldRow('Remarks', fai['decision_remarks']),
              ],
            ]),
          ],
        ),
      ),
    );
  }
}
