import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';
import 'crm_inquiry_forms.dart';
import 'crm_quotations.dart';
import 'crm_record_tabs.dart';

/// Opens an inquiry or tender by id.
void openCrmRecord(BuildContext context, CrmKind kind, int id, {VoidCallback? onChanged}) =>
    openScreen(context, CrmRecordScreen(kind: kind, id: id, onChanged: onChanged));

/// Inquiry / tender detail (InquiryDetailPanel.tsx / TenderDetailPanel.tsx).
class CrmRecordScreen extends StatefulWidget {
  const CrmRecordScreen({super.key, required this.kind, required this.id, this.onChanged, this.initialTab});
  final CrmKind kind;
  final int id;
  final VoidCallback? onChanged;

  /// 'Quotations' / 'Technical Offers' (approval links).
  final String? initialTab;

  @override
  State<CrmRecordScreen> createState() => _CrmRecordScreenState();
}

class _CrmRecordScreenState extends State<CrmRecordScreen> {
  Json? _rec;
  Json? _org;
  Json? _contact;
  Json? _rnd;
  List<Json> _revisions = const [];
  int? _revSel;
  Object? _error;
  String _tab = 'Info';
  bool _sending = false;

  bool get _isInq => widget.kind == CrmKind.inquiry;
  String get _base => widget.kind.base(widget.id);

  @override
  void initState() {
    super.initState();
    if (widget.initialTab != null) _tab = widget.initialTab!;
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      final rec = Map<String, dynamic>.from(r as Map);
      if (mounted) {
        setState(() {
          _rec = rec;
          _error = null;
        });
      }
      final orgId = asInt(rec['org_id']);
      if (orgId != null) {
        Api.get('/crm/organizations/$orgId').then((o) {
          if (mounted && o is Map) setState(() => _org = Map<String, dynamic>.from(o));
        }).catchError((_) {});
        final cid = asInt(rec['org_contact_id']);
        if (cid != null) {
          loadContacts(orgId).then((cs) {
            if (mounted) setState(() => _contact = cs.where((c) => asInt(c['id']) == cid).firstOrNull);
          }).catchError((_) {});
        } else {
          _contact = null;
        }
      }
      _loadRevisions();
      _loadRnd();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _loadRevisions() async {
    try {
      final r = (await Api.list('$_base/spec-revisions', query: {if (_isInq) 'requirement_only': true})).rows;
      if (mounted) setState(() => _revisions = r);
    } catch (_) {}
  }

  Future<void> _loadRnd() async {
    try {
      final r = await Api.get('$_base/rnd-requirement');
      if (mounted) setState(() => _rnd = r is Map ? Map<String, dynamic>.from(r) : null);
    } catch (_) {
      if (mounted) setState(() => _rnd = null);
    }
  }

  void _changed() {
    widget.onChanged?.call();
    _load();
  }

  bool get _canModify => _rec != null && CrmPerm.ownerOrAdmin(_rec!['created_by_id']) && CrmPerm.can('inquiries_tenders', 'edit');
  bool get _canDelete => _rec != null && CrmPerm.canDelete('inquiries_tenders', _rec!['created_by_id']);
  bool get _canSendTor => CrmPerm.it('send_tor', 'create');

  bool get _torActive {
    final r = _rec!;
    final sent = dateOf(r['technical_offer_sent_at']);
    final upd = dateOf(r['updated_at']);
    return sent == null || (upd != null && upd.isAfter(sent));
  }

  bool get _canSendAgain => _torActive || _rnd?['status'] == 'returned';

  List<String> get _tabs {
    final all = _isInq
        ? ['Info', 'Documents', 'Technical Offers', 'Quotations', 'Follow Ups', 'Timeline']
        : ['Info', 'Dates', 'Technical Offers', 'Documents', 'Follow Ups', 'Timeline'];
    bool see(String t) => switch (t) {
          'Info' => true,
          'Dates' => CrmPerm.it('tender_dates', 'view'),
          'Quotations' => CrmPerm.it('quotations', 'view'),
          'Technical Offers' => CrmPerm.it('technical_offer', 'view'),
          'Documents' => CrmPerm.it('documents', 'view'),
          'Follow Ups' => CrmPerm.it('followups', 'view'),
          'Timeline' => CrmPerm.it('timeline', 'view'),
          _ => false,
        };
    return all.where(see).toList();
  }

  Future<void> _sendTor() async {
    final r = _rec!;
    if (_isInq && (str(r['product']).isEmpty || str(r['product_spec']).isEmpty)) {
      showSnack(
          context,
          'Please fill Product and Customer Requirement (click Edit) before sending the Technical Requirement to R&D — otherwise R&D gets a document with no requirement details.',
          error: true);
      return;
    }
    setState(() => _sending = true);
    final res = await sendToRnd(context, widget.kind, widget.id);
    if (mounted) setState(() => _sending = false);
    if (res != null) {
      if (mounted) showSnack(context, 'Technical Requirement sent to R&D.');
      setState(() => _tab = 'Info');
      _changed();
    }
  }

  Future<void> _edit() async {
    final saved = _isInq ? await showInquiryForm(context, initial: _rec) : await showTenderForm(context, initial: _rec);
    if (saved != null) _changed();
  }

  Future<void> _delete() async {
    final yes = await confirmDialog(context,
        title: 'Delete this ${widget.kind.key}?',
        message: 'Delete ${widget.kind.key} ${str(_rec!['universal_id'])}? This action cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    if (await crmRun(context, () => Api.delete(_base), success: '${widget.kind.label} deleted.')) {
      widget.onChanged?.call();
      if (mounted) Navigator.pop(context);
    }
  }

  /// Status / priority quick change (lead info).
  Future<void> _patchLead(Map<String, dynamic> payload) async {
    if (await crmRun(context, () => Api.patch(_base, data: payload), success: 'Saved.')) _changed();
  }

  Future<void> _pickStatus() async {
    final list = keepCurrent(_isInq ? CrmLists.inquiryStatuses : CrmLists.tenderStatuses, _rec!['status']);
    final picked = await _pickFrom('Status', list, str(_rec!['status']));
    if (picked == null || !mounted) return;
    if (_isInq && picked == CrmLists.lostStatus && str(_rec!['lost_reason_code']).isEmpty) {
      final lost = await askLostReason(context);
      if (lost == null) return;
      _patchLead({'status': picked, ...lost});
    } else {
      _patchLead({'status': picked});
    }
  }

  Future<void> _pickPriority() async {
    final picked = await _pickFrom('Customer requirement priority', CrmLists.priorities, CrmLists.normalizePriority(_rec!['priority']),
        label: CrmLists.priorityLabel);
    if (picked != null) _patchLead({'priority': picked});
  }

  Future<String?> _pickFrom(String title, List<String> values, String current, {String Function(String)? label}) =>
      showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.white,
        builder: (ctx) => SafeArea(
          child: ListView(shrinkWrap: true, children: [
            Padding(padding: const EdgeInsets.all(16), child: Caps(title)),
            for (final v in values)
              ListTile(
                title: Text(label == null ? v : label(v)),
                trailing: v == current ? const Icon(Icons.check_rounded, color: Brand.primary) : null,
                onTap: v == current ? null : () => Navigator.pop(ctx, v),
              ),
          ]),
        ),
      );

  Future<void> _changeStage(String stage) async {
    final cur = str(_rec!['current_stage']);
    final back = CrmLists.tenderStages.indexOf(stage) < CrmLists.tenderStages.indexOf(cur);
    if (back) {
      final reason = await promptDialog(context,
          title: 'Move Stage Back',
          message: 'Move this tender back from "$cur" to "$stage"? This reverses the pipeline — the reason is kept on the timeline.',
          label: 'Reason for moving the stage back',
          confirmLabel: 'Move Back');
      if (reason == null) return;
      _patchLead({'current_stage': stage, 'stage_reason': reason.trim()});
    } else {
      final yes = await confirmDialog(context,
          title: 'Update Stage',
          message: 'Move this tender from "$cur" to "$stage"? The move is recorded on the timeline.',
          confirmLabel: 'Update Stage');
      if (yes) _patchLead({'current_stage': stage});
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _rec;
    if (r == null) {
      return SubPage(
        title: widget.kind.label,
        body: _error != null ? ErrorView(crmError(_error!), onRetry: _load) : const LoadingView(),
      );
    }
    final tabs = _tabs;
    if (!tabs.contains(_tab)) _tab = 'Info';
    final color = _isInq ? CrmLists.inquiryColor(r['status']) : CrmLists.tenderColor(r['status']);
    final heading = _isInq
        ? (str(_org?['name']).isEmpty ? 'Inquiry' : str(_org!['name']))
        : (str(r['tender_name']).isNotEmpty ? str(r['tender_name']) : (str(_org?['name']).isEmpty ? 'Tender' : str(_org!['name'])));
    final buttons = <Widget>[
      if (_canDelete) dangerBtn('Delete', _delete),
      if (_canModify) secondaryBtn('Edit', _edit),
      if (_canSendTor)
        primaryBtn(_sending ? 'Sending…' : 'Send Technical Requirement to R&D', !_canSendAgain || _sending ? null : _sendTor),
    ];
    return SubPage(
      title: str(r['universal_id']),
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Text(str(r['universal_id']), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.primary)),
              if (_isInq && r['created_at'] != null) Text(fmtDate(r['created_at']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
              pill(r['status'], color),
            ]),
            const SizedBox(height: 4),
            Text(heading, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: Brand.heading)),
            if (str(r['technical_offer_number']).isNotEmpty)
              Note('${_torActive ? 'Previously sent as ' : 'Sent as '}${r['technical_offer_number']}'
                  '${r['technical_offer_sent_at'] == null ? '' : ' on ${fmtDateTime(r['technical_offer_sent_at'])}'}'
                  '${!_canSendAgain && _canSendTor ? ' — edit the ${widget.kind.key} to send again.' : ''}'),
          ]),
        ),
        Expanded(
          child: _tab == 'Info'
              ? RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
                    if (!_isInq) _stageBar(r),
                    RndIntakeCard(rnd: _rnd, canResend: _canSendTor && !_sending, onResend: _sendTor),
                    SubTabs(tabs: tabs, index: tabs.indexOf(_tab), onChanged: (i) => setState(() => _tab = tabs[i])),
                    ..._isInq ? _inquiryInfo(r) : _tenderInfo(r),
                  ]),
                )
              : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  SubTabs(tabs: tabs, index: tabs.indexOf(_tab), onChanged: (i) => setState(() => _tab = tabs[i])),
                  Expanded(child: KeyedSubtree(key: ValueKey(_tab), child: _tabBody(r))),
                ]),
        ),
      ]),
      bottom: buttons.isEmpty ? null : actionBar(buttons),
    );
  }

  Widget _tabBody(Json r) {
    switch (_tab) {
      case 'Quotations':
        return QuotationsTab(inquiry: r, org: _org, contact: _contact);
      case 'Technical Offers':
        return TechnicalOffersTab(kind: widget.kind, recordId: widget.id);
      case 'Documents':
        return CrmDocumentsTab(kind: widget.kind, record: r, canModify: _canModify && CrmPerm.it('documents', 'create'));
      case 'Follow Ups':
        return FollowUpsTab(kind: widget.kind, record: r, orgName: _org?['name'] as String?);
      case 'Timeline':
        return TimelineTab(kind: widget.kind, recordId: widget.id);
      case 'Dates':
        String day(Object? v) => str(v).isEmpty ? '—' : fmtDate(v);
        final closing = str(r['closing_at']);
        return tabList(_load, [
          DetailSection('Milestone (4)', children: [
            row('Publish Date', day(r['publish_date'])),
            row('Document Download', day(r['doc_download_date'])),
            row('Submission Date', day(r['submission_date'])),
            row('Tender Closing', closing.length >= 16 ? '${fmtDate(closing.substring(0, 10))} ${closing.substring(11, 16)}' : '—'),
          ]),
        ]);
    }
    return const SizedBox.shrink();
  }

  Widget _stageBar(Json r) {
    final cur = str(r['current_stage']);
    final idx = CrmLists.tenderStages.indexOf(cur);
    final can = _canModify && CrmPerm.it('stage', 'edit');
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        itemCount: CrmLists.tenderStages.length,
        separatorBuilder: (_, _) => const Icon(Icons.chevron_right_rounded, size: 18, color: Brand.muted),
        itemBuilder: (ctx, i) {
          final s = CrmLists.tenderStages[i];
          final done = i <= idx;
          return InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: can && s != cur ? () => _changeStage(s) : null,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: s == cur ? Brand.primary : done ? Brand.primarySoft : Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: done ? Brand.primary : Brand.border),
              ),
              child: Text(s,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: s == cur ? FontWeight.w700 : FontWeight.w500,
                      color: s == cur ? Colors.white : Brand.body)),
            ),
          );
        },
      ),
    );
  }

  Json? get _selRev => _revisions.where((x) => asInt(x['id']) == _revSel).firstOrNull;

  Widget _spec(String label, String field, Object? value) {
    final ch = jsonList(_selRev?['changes']).where((c) => c['field'] == field).firstOrNull;
    if (ch == null) return row(label, value);
    return FieldRow(
        label,
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(txt(value)),
          Text('Was: ${str(ch['old']).trim().isEmpty ? '(empty)' : str(ch['old'])}',
              style: const TextStyle(fontSize: 12, color: Brand.danger, decoration: TextDecoration.lineThrough)),
        ]));
  }

  Widget _revisionPicker() {
    if (_revisions.isEmpty) return const SizedBox.shrink();
    final sel = _selRev;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        AppSelect<int>(
          label: 'Revision (${_revisions.length})',
          value: _revSel,
          options: [
            for (var i = 0; i < _revisions.length; i++)
              Option(asInt(_revisions[i]['id'])!, 'Revision ${_revisions.length - i}',
                  subtitle: joinNonEmpty([_revisions[i]['performed_by'], fmtDateTime(_revisions[i]['performed_at'])], ' · ')),
          ],
          onChanged: (o) => setState(() => _revSel = o?.value),
        ),
        if (sel != null) ...[
          const SizedBox(height: 8),
          InfoBox(
              'What changed in this revision\n${jsonList(sel['changes']).isEmpty ? 'No changes recorded for this revision.' : changesText(jsonList(sel['changes']))}',
              color: Brand.primaryActive,
              bg: Brand.primarySoft),
        ],
      ]),
    );
  }

  List<Widget> _customer(Json r, {required bool tender}) {
    if (!CrmPerm.it('customer_contact', 'view')) return const [];
    final o = _org;
    final c = _contact;
    return [
      DetailSection('Customer', children: [
        if (tender) row('Customer organization', o?['name']) else row('Client company', o == null ? null : joinNonEmpty([o['name'], o['org_type']])),
        if (!tender) row('GST number', o?['gst_number']),
        if (!tender) row('Address', o == null ? null : joinNonEmpty([o['address'], o['city'], o['state']])),
        if (tender) _spec('Railway zone', 'railway_zone', r['railway_zone']),
        if (tender) _spec('Division', 'division', r['division']),
        row('Contact person', c == null ? null : joinNonEmpty([c['name'], c['designation'], c['department']])),
        row('Mobile', c == null ? null : joinNonEmpty([c['mobile'], ...strList(c['additional_mobiles'])])),
        row('Email', c == null ? null : joinNonEmpty([c['email'], ...strList(c['additional_emails'])])),
      ]),
    ];
  }

  Widget _tapValue(Widget child, VoidCallback? onTap) => onTap == null
      ? child
      : InkWell(
          onTap: onTap,
          child: Row(children: [Flexible(child: child), const SizedBox(width: 4), const Icon(Icons.edit_outlined, size: 16, color: Brand.primary)]));

  List<Widget> _inquiryInfo(Json r) {
    final lostCode = str(r['lost_reason_code']);
    final lostReason = lostCode.isEmpty
        ? null
        : '${CrmLists.lostReasonLabels[lostCode] ?? lostCode}${str(r['lost_to_competitor']).isEmpty ? '' : ' — ${r['lost_to_competitor']}'}'
            '${str(r['lost_remarks']).isEmpty ? '' : ' (${r['lost_remarks']})'}';
    return [
      _revisionPicker(),
      DetailSection(str(r['product']).isEmpty ? 'Product not filled in yet' : str(r['product']), children: [
        Text(str(r['current_status_note']).isEmpty
            ? 'No current status written yet — use Edit to add where this inquiry stands.'
            : str(r['current_status_note'])),
        const SizedBox(height: 6),
        Note(joinNonEmpty([
          'Inquiry of ${fmtDate(r['created_at'])}',
          'Lead source: ${txt(r['lead_source'])}',
          'BD Owner: ${txt(r['bd_owner'])}',
          if (str(r['created_by_name']).isNotEmpty) 'Created by ${r['created_by_name']}',
        ], ' · ')),
      ]),
      ..._customer(r, tender: false),
      DetailSection('Lead', children: [
        FieldRow('Status', _tapValue(pill(r['status'], CrmLists.inquiryColor(r['status'])), _canModify ? _pickStatus : null)),
        FieldRow('Customer requirement priority',
            _tapValue(Text(str(r['priority']).isEmpty ? '—' : CrmLists.priorityLabel(r['priority'])), _canModify ? _pickPriority : null)),
        if (CrmPerm.it('prices', 'view') && r['expected_value'] != null) row('Expected value', money(r['expected_value'])),
        if (r['probability'] != null) row('Win probability', '${r['probability']}%'),
        if (r['expected_order_date'] != null) row('Expected order', fmtDate(r['expected_order_date'])),
        if (lostReason != null) row('Lost reason', lostReason),
      ]),
      DetailSection('Product Requirement', children: [
        _spec('Product', 'product', r['product']),
        _spec('Customer requirement', 'product_spec', r['product_spec']),
        for (final (i, it) in jsonList(r['additional_items']).indexed)
          FieldRow('Additional product ${i + 1}', joinNonEmpty([it['product'] ?? '—', it['product_spec']], '\n')),
        _spec('Project details', 'project_details', r['project_details']),
      ]),
    ];
  }

  List<Widget> _tenderInfo(Json r) {
    return [
      _revisionPicker(),
      DetailSection(str(r['tender_number']).isEmpty ? 'Tender number not filled in yet' : 'Tender No. ${r['tender_number']}', children: [
        Text(str(r['current_status_note']).isEmpty
            ? 'No current status written yet — use Edit to add where this tender stands.'
            : str(r['current_status_note'])),
        const SizedBox(height: 6),
        Note(joinNonEmpty([
          'Submission due: ${str(r['submission_date']).isEmpty ? '—' : fmtDate(r['submission_date'])}',
          if (str(r['priority']).isNotEmpty) 'Priority: ${CrmLists.priorityLabel(r['priority'])}',
          'BD Owner: ${txt(r['bd_owner'])}',
          if (r['created_at'] != null) 'Created ${fmtDate(r['created_at'])}${str(r['created_by_name']).isEmpty ? '' : ' by ${r['created_by_name']}'}',
        ], ' · ')),
      ]),
      DetailSection('Tender Information', children: [
        FieldRow('Status', _tapValue(pill(r['status'], CrmLists.tenderColor(r['status'])), _canModify ? _pickStatus : null)),
        _spec('Tender details', 'tender_details', r['tender_details']),
        _spec('Tender authority', 'tender_authority', r['tender_authority']),
        _spec('Tender portal', 'tender_portal', r['tender_portal']),
        _spec('Tender type', 'tender_type', r['tender_type']),
        if (CrmPerm.it('prices', 'view'))
          _spec('Tender value', 'tender_value', r['tender_value'] == null ? null : '${str(r['currency'])} ${fmtNumber(r['tender_value'])}'),
        row('Lead source', r['lead_source']),
      ]),
      ..._customer(r, tender: true),
    ];
  }
}
