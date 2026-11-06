import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';

/// Finance › Journals (portal finance/ledger/page.tsx + ledger/voucher).
class FinJournalsPage extends StatelessWidget {
  const FinJournalsPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Journals',
        subtitle: 'Manual journal vouchers, the day book of every voucher, ledger statements and month-end period close.',
        tabs: [
          FinSubTab('Journal Vouchers', (_) => const _JournalVouchers(), permTab: 'journal_vouchers'),
          FinSubTab('Day Book', (_) => const _DayBook(), permTab: 'day_book'),
          FinSubTab('Ledger Statement', (_) => const _LedgerStatement(), permTab: 'ledger_statement'),
          FinSubTab('Period Close', (_) => const _PeriodClose(), permTab: 'period_close'),
        ],
      );
}

const _manualTypes = ['adjustment', 'accrual', 'correction', 'depreciation'];

String _firstOfNextMonth(DateTime d) => apiDate(DateTime(d.year, d.month + 1, 1));

// ── Journal vouchers ─────────────────────────────────────────────────────────

class _JournalVouchers extends StatefulWidget {
  const _JournalVouchers();

  @override
  State<_JournalVouchers> createState() => _JournalVouchersState();
}

class _JournalVouchersState extends State<_JournalVouchers> {
  final _list = GlobalKey<ApiListViewState>();
  String? _status;
  String? _voucherType;
  String? _postingType;
  DateTime? _from;
  DateTime? _to;
  final _lookup = TextEditingController();
  bool _lookingUp = false;

  @override
  void dispose() {
    _lookup.dispose();
    super.dispose();
  }

  void _reload() => _list.currentState?.reload();

  Future<void> _openByNumber() async {
    final no = _lookup.text.trim();
    if (no.isEmpty) return;
    setState(() => _lookingUp = true);
    try {
      final je = asJson(await Api.get('/accounts/journal-entries/by-number', query: {'entry_number': no}));
      if (mounted) openScreen(context, FinVoucherScreen(entryId: toInt(je['id'])!));
    } catch (e) {
      if (mounted) showSnack(context, 'Could not open voucher $no. ${ApiClient.describe(e)}', error: true);
    } finally {
      if (mounted) setState(() => _lookingUp = false);
    }
  }

  Future<void> _new() async {
    final ok = await showJournalForm(context);
    if (ok) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = [_status, _voucherType, _postingType, _from, _to].any((x) => x != null);
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton:
          finCan('journal_vouchers', 'create') ? CreateFab(label: 'New Journal', onPressed: _new) : null,
      body: ApiListView(
        key: _list,
        load: (page, search) async {
          final rows = asRows(await Api.get('/accounts/journal-entries', query: {
            'status': _status,
            'voucher_type': _voucherType,
            'posting_type': _postingType,
            'from_date': dateOrNull(_from),
            'to_date': dateOrNull(_to),
          }));
          return ApiPage(rows);
        },
        emptyText: 'No journal entries match these filters.',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const InfoBanner(
              'Manual journals are drafted by one user and posted by another (maker-checker) — the second pair of eyes is the '
              'control against errors and fraud. A posted entry\'s amounts and ledgers are never edited or deleted; it is reversed '
              'with a reason and, if needed, re-entered correctly. Only its narration and line remarks can be changed (Open voucher → Change), and '
              'each change is logged.'),
          padded(Row(children: [
            Expanded(
              child: TextField(
                controller: _lookup,
                textInputAction: TextInputAction.go,
                onSubmitted: (_) => _openByNumber(),
                decoration: fieldDecoration('Open voucher no.', hint: 'e.g. JV/2026-27/0001'),
              ),
            ),
            const SizedBox(width: 8),
            actionBtn(_lookingUp ? 'Opening…' : 'Open', _lookingUp ? null : _openByNumber),
          ])),
          padded(Row(children: [
            Expanded(
              child: AppSelect<String>(
                label: 'Status',
                value: _status,
                options: [for (final e in kVoucherStatusLabels.entries) Option(e.key, e.value)],
                onChanged: (o) => setState(() {
                  _status = o?.value;
                  _reload();
                }),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: AppSelect<String>(
                label: 'Voucher Type',
                value: _voucherType,
                options: [for (final e in kVoucherLabels.entries) Option(e.key, e.value)],
                onChanged: (o) => setState(() {
                  _voucherType = o?.value;
                  _reload();
                }),
              ),
            ),
          ])),
          padded(AppSelect<String>(
            label: 'Posting Type',
            value: _postingType,
            options: [for (final e in kPostingLabels.entries) Option(e.key, e.value)],
            onChanged: (o) => setState(() {
              _postingType = o?.value;
              _reload();
            }),
          )),
          DateRangeRow(
              from: _from,
              to: _to,
              onChanged: (f, t) => setState(() {
                    _from = f;
                    _to = t;
                    _reload();
                  })),
          if (filtered)
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 8),
                child: TextButton(
                    onPressed: () => setState(() {
                          _status = _voucherType = _postingType = null;
                          _from = _to = null;
                          _reload();
                        }),
                    child: const Text('Clear')),
              ),
            ),
        ]),
        itemBuilder: (ctx, e, reload) {
          final draft = e['status'] == 'draft';
          return RecordCard(
            code: draft ? 'Draft' : '${e['entry_number']}',
            title: (e['description'] ?? '').toString().isEmpty ? '—' : '${e['description']}',
            subtitle: e['reversal_reason'] != null ? 'Reversed ${fmtDate(e['reversal_date'])}: ${e['reversal_reason']}' : null,
            trailing: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                FinStatusPill(e['status'], labels: kVoucherStatusLabels, colors: kVoucherStatusHex),
                if (draft) ...[
                  const SizedBox(height: 4),
                  ApprovalBadge(status: e['approval_status'] as String?, stage: e['approval_stage'] as String?),
                ],
              ]),
            ),
            meta: [
              ('Date', fmtDate(e['posting_date'])),
              ('Voucher', kVoucherLabels['${e['voucher_type']}'] ?? '${e['voucher_type']}'),
              (
                'Posting Type',
                '${kPostingLabels['${e['posting_type']}'] ?? e['posting_type']}${e['auto_reverse_on'] != null ? ' · auto-reverses ${fmtDate(e['auto_reverse_on'])}' : ''}'
              ),
              ('Amount', inr(e['total_debit'])),
              ('Created By', txt(e['created_by_name'])),
              if (e['posted_by_name'] != null) ('Posted', '${e['posted_by_name']}'),
            ],
            onTap: () async {
              await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => FinVoucherScreen(entryId: toInt(e['id'])!)));
              reload();
            },
          );
        },
      ),
    );
  }
}

/// Mirrors the backend gate on POST /journal-entries/{id}/reverse.
String? _reverseBlockedReason(Json e, bool canReverse) {
  if (e['reverses_journal_entry_id'] != null) {
    return 'This entry is itself a reversal — post a fresh journal if the original was right.';
  }
  if (e['reference_document_type'] != null) {
    return 'Posted by a ${'${e['reference_document_type']}'.replaceAll('_', ' ')} — correct it through that document (note, voucher cancel, depreciation run, valuation).';
  }
  if (e['posting_type'] == 'year_end') return 'Year-end closing entry — use Reports > Year-end > Reopen.';
  if (e['posting_type'] == 'closing_stock') return 'Closing-stock entry — cancel the valuation under Finance > Inventory.';
  if (e['posting_type'] == 'asset_disposal') return 'Asset disposal — correct it on the asset under Finance > Assets.';
  if (!canReverse) {
    return "Only a Finance Manager (or admin) whose role includes Journal Vouchers › Reverse posted journals can reverse a journal. Ask an admin to tick 'Finance Manager' on your user and grant that feature in your role.";
  }
  return null;
}

const _historyLabels = {
  'created': 'Drafted', 'submitted': 'Submitted', 'posted': 'Posted', 'discarded': 'Discarded', 'reversed': 'Reversed',
  'text_changed': 'Text changed', 'approved': 'Approved', 'rejected': 'Rejected',
};

/// One voucher (portal ledger/voucher): header, lines, proof, approval,
/// history and the draft / posted actions.
class FinVoucherScreen extends StatefulWidget {
  const FinVoucherScreen({super.key, required this.entryId});
  final int entryId;

  @override
  State<FinVoucherScreen> createState() => _FinVoucherScreenState();
}

class _FinVoucherScreenState extends State<FinVoucherScreen> {
  int _tick = 0;
  void _reload() => setState(() => _tick++);

  bool get _seeHistory => finCanFeature('journal_vouchers', 'change_history', 'view');

  Future<(Json, List<Json>)> _load() async {
    final e = asJson(await Api.get('/accounts/journal-entries/${widget.entryId}'));
    final h = _seeHistory ? asRows(await Api.get('/accounts/journal-entries/${widget.entryId}/history')) : <Json>[];
    return (e, h);
  }

  Future<void> _post(Json e) async {
    final ok = await confirmDialog(context,
        title: 'Post this journal?',
        message:
            'Posting gives it a JV number and updates every ledger on it (${inr(e['total_debit'])}). After posting it can only be corrected by reversal.',
        confirmLabel: 'Post Journal');
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.post('/accounts/journal-entries/${e['id']}/post'), success: 'Journal posted.')) _reload();
  }

  Future<void> _discard(Json e) async {
    final ok = await confirmDialog(context,
        title: 'Discard this draft?',
        message:
            'The draft never reached the books, so discarding it leaves no ledger impact. It stays listed as Discarded for the audit trail.',
        confirmLabel: 'Discard Draft',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.post('/accounts/journal-entries/${e['id']}/discard'), success: 'Draft discarded.')) {
      _reload();
    }
  }

  Future<void> _submit(Json e) async {
    if (await runAction(context, () => Api.post('/accounts/journal-entries/${e['id']}/submit'),
        success: 'Sent for approval.')) {
      _reload();
    }
  }

  Future<void> _reverse(Json e) async {
    final reason = TextEditingController();
    DateTime? date;
    final saved = await showFormSheet(
      context,
      title: 'Reverse ${e['entry_number']}?',
      saveLabel: 'Reverse Entry',
      builder: (ctx, setS) => [
        const Text('A new journal with every Dr and Cr swapped is posted; the original stays in the books marked Reversed.',
            style: TextStyle(color: Brand.muted)),
        AppTextField(label: 'Reason', required: true, controller: reason, maxLines: 3, hint: 'Why is this entry being reversed?'),
        DateField(label: 'Reversal date', value: date, onChanged: (d) => setS(() => date = d)),
        const Text(
            'Blank = today. Entries raised by an invoice, note or payment voucher must be corrected through that document instead.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        requireField(reason.text, 'Reason');
        await Api.post('/accounts/journal-entries/${e['id']}/reverse',
            data: {'reason': reason.text.trim(), 'reversal_date': dateOrNull(date)});
      },
    );
    if (saved) _reload();
  }

  Future<void> _change(Json e) async {
    final desc = TextEditingController(text: '${e['description'] ?? ''}');
    final lines = listOf(e['lines']);
    final remarks = {for (final l in lines) toInt(l['id'])!: TextEditingController(text: '${l['remarks'] ?? ''}')};
    String? source;
    final ref = e['reference_document_type'];
    if (ref != null) {
      final s = kSourceDocuments['$ref'];
      source = s == null ? ' (for this one: through the document that posted it)' : ' (for this one: through the ${s.$1.toLowerCase()} in ${s.$2})';
    }
    final saved = await showFormSheet(
      context,
      title: 'Change ${e['entry_number']}',
      builder: (ctx, setS) => [
        const Text('Only the narration and line remarks can be changed after posting — they move no money.',
            style: TextStyle(color: Brand.muted)),
        InfoBanner(
            'A wrong ledger, amount, party, cost centre or date is corrected by reversing the voucher${source ?? ''}.',
            tone: Tone.warning),
        AppTextField(label: 'Narration', controller: desc, maxLines: 3, hint: 'What is this entry for?'),
        const Caps('Line remarks'),
        for (final l in lines)
          AppTextField(
            label:
                '#${l['line_number']} · ${l['gl_account_code']} — ${l['gl_account_name']} · ${toD(l['debit_amount']) != 0 ? 'Dr ${inr(l['debit_amount'])}' : 'Cr ${inr(l['credit_amount'])}'}',
            controller: remarks[toInt(l['id'])!],
          ),
        const Text('Every change is recorded in the voucher history with the old and new text.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        final changed = [
          for (final l in lines)
            if (remarks[toInt(l['id'])!]!.text.trim() != '${l['remarks'] ?? ''}')
              {'line_id': l['id'], 'remarks': remarks[toInt(l['id'])!]!.text.trim().isEmpty ? null : remarks[toInt(l['id'])!]!.text.trim()},
        ];
        final descChanged = desc.text.trim() != '${e['description'] ?? ''}';
        if (!descChanged && changed.isEmpty) return;
        await Api.patch('/accounts/journal-entries/${e['id']}/details', data: {
          if (descChanged) 'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
          if (changed.isNotEmpty) 'lines': changed,
        });
      },
    );
    if (saved && mounted) {
      showSnack(
          context,
          _seeHistory
              ? 'Saved. The change is recorded in the history below with the old and new text.'
              : 'Saved. The change is recorded in the voucher history.');
      _reload();
    }
  }

  List<Widget> _actions(Json e) {
    final out = <Widget>[];
    final status = e['status'];
    final isMaker = Perm.userId != null && toInt(e['created_by_id']) == Perm.userId;
    if (status == 'draft') {
      if (e['approval_status'] != 'pending' && finCan('journal_vouchers', 'submit')) {
        out.add(actionBtn('Submit for approval', () => _submit(e)));
      }
      if (!isMaker && finCan('journal_vouchers', 'approve')) out.add(actionBtn('Post', () => _post(e), primary: true));
      if (finCan('journal_vouchers', 'delete')) out.add(actionBtn('Discard', () => _discard(e), danger: true));
    }
    if (status == 'posted') {
      final canReverse = isFinanceManager && finCanFeature('journal_vouchers', 'reversal', 'cancel');
      if (_reverseBlockedReason(e, canReverse) == null) out.add(actionBtn('Reverse', () => _reverse(e), danger: true));
    }
    if ((status == 'posted' || status == 'reversed') && finCan('journal_vouchers', 'edit')) {
      out.add(actionBtn('Change', () => _change(e)));
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<(Json, List<Json>)>(
      key: ValueKey(_tick),
      load: _load,
      builder: (ctx, data, reload) {
        final (e, history) = data;
        final lines = listOf(e['lines']);
        final ref = e['reference_document_type'];
        final src = ref == null ? null : kSourceDocuments['$ref'];
        final srcText = ref == null ? 'Manual journal' : (src == null ? '${'$ref'.replaceAll('_', ' ')} (the document that posted it)' : '${src.$1} (${src.$2})');
        final isMaker = Perm.userId != null && toInt(e['created_by_id']) == Perm.userId;
        final canReverse = isFinanceManager && finCanFeature('journal_vouchers', 'reversal', 'cancel');
        final blocked = e['status'] == 'posted' ? _reverseBlockedReason(e, canReverse) : null;
        final actions = _actions(e);
        return SubPage(
          title: e['status'] == 'draft' ? 'Draft journal' : '${e['entry_number']}',
          bottom: actions.isEmpty ? null : ActionBar(actions),
          body: ListView(
            padding: const EdgeInsets.only(top: 12, bottom: 24),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  Text('₹ ${inr(e['total_debit']).replaceAll('₹', '')}',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Brand.heading)),
                  FinStatusPill(e['status'], labels: kVoucherStatusLabels, colors: kVoucherStatusHex),
                  if (e['status'] == 'draft')
                    ApprovalBadge(status: e['approval_status'] as String?, stage: e['approval_stage'] as String?),
                  Text(src != null ? 'From ${src.$1.toLowerCase()}' : 'Manual journal', style: const TextStyle(color: Brand.muted)),
                ]),
              ),
              if (e['status'] == 'draft' && isMaker)
                const InfoBanner('You drafted this journal — it must be posted by another finance user (maker-checker).'),
              if (blocked != null) InfoBanner(blocked),
              DetailSection('Posting', children: [
                FieldRow('Voucher type', kVoucherLabels['${e['voucher_type']}'] ?? humanize(e['voucher_type'])),
                FieldRow('Posting type', kPostingLabels['${e['posting_type']}'] ?? humanize(e['posting_type'])),
                FieldRow('Posting date', fmtDate(e['posting_date'])),
                FieldRow('Period / financial year',
                    '${e['accounting_period'] ?? ''}${e['financial_year'] != null ? ' · FY ${e['financial_year']}' : ''}'),
                FieldRow('Amount (Dr = Cr)', inr(e['total_debit'])),
                FieldRow('Source', srcText),
                FieldRow('Narration', e['description']),
              ]),
              if (e['auto_reverse_on'] != null || e['reverses_journal_entry_id'] != null || e['status'] == 'reversed')
                DetailSection('Reversal', children: [
                  if (e['auto_reverse_on'] != null) FieldRow('Auto-reverses on', fmtDate(e['auto_reverse_on'])),
                  if (e['reverses_journal_entry_id'] != null)
                    FieldRow(
                        'Reverses',
                        _VoucherLink(
                            id: toInt(e['reverses_journal_entry_id'])!, label: '${e['reverses_entry_number'] ?? 'original voucher'}')),
                  if (e['status'] == 'reversed') ...[
                    FieldRow(
                        'Reversed by voucher',
                        e['reversal_journal_entry_id'] == null
                            ? '—'
                            : _VoucherLink(
                                id: toInt(e['reversal_journal_entry_id'])!, label: '${e['reversal_entry_number'] ?? 'reversal'}')),
                    FieldRow('Reversed on',
                        '${fmtDate(e['reversal_date'])}${e['reversed_by_name'] != null ? ' by ${e['reversed_by_name']}' : ''}'),
                    FieldRow('Reason', e['reversal_reason']),
                  ],
                ]),
              DetailSection('People', children: [
                FieldRow('Drafted by',
                    e['created_by_name'] == null ? null : '${e['created_by_name']}${e['created_at'] != null ? ' · ${fmtDate(e['created_at'])}' : ''}'),
                FieldRow('Posted by', e['posted_by_name']),
              ]),
              if (e['status'] == 'draft')
                ApprovalPanel(entityType: 'accounts_journal_entry', entityId: toInt(e['id'])!, onChanged: reload),
              DetailSection('Lines (${lines.length})', children: [
                for (final l in lines)
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x140F172A)))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(
                          child: Text('#${l['line_number'] ?? ''} ${l['gl_account_code']} — ${l['gl_account_name']}',
                              style: const TextStyle(fontWeight: FontWeight.w600)),
                        ),
                        Text(
                          toD(l['debit_amount']) != 0 ? 'Dr ${inr(l['debit_amount'])}' : 'Cr ${inr(l['credit_amount'])}',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ]),
                      if (l['cost_center_name'] != null) Text('Cost Centre: ${l['cost_center_name']}', style: _small),
                      if (l['internal_order_name'] != null) Text('Internal Order: ${l['internal_order_name']}', style: _small),
                      if (l['vendor_id'] != null) Text('Party: Vendor #${l['vendor_id']}', style: _small),
                      if (l['customer_id'] != null) Text('Party: Customer #${l['customer_id']}', style: _small),
                      if ((l['remarks'] ?? '').toString().isNotEmpty) Text('${l['remarks']}', style: _small),
                    ]),
                  ),
                const SizedBox(height: 6),
                AmountRow('Total Dr', inr(e['total_debit']), bold: true),
                AmountRow('Total Cr', inr(e['total_credit']), bold: true),
              ]),
              FinanceAttachments(
                entityType: 'journal',
                entityId: toInt(e['id'])!,
                tabKey: 'journal_vouchers',
                locked: e['status'] != 'draft',
                closed: e['status'] == 'cancelled' || e['status'] == 'reversed',
              ),
              if (_seeHistory)
                DetailSection('History (${history.length})', children: [
                  if (history.isEmpty) const Text('No history recorded for this voucher.', style: TextStyle(color: Brand.muted)),
                  for (final h in history)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${_historyLabels['${h['action']}'] ?? humanize(h['action'])} · ${h['performed_by_name'] ?? '—'}',
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(fmtDateTime(h['performed_at']), style: _small),
                        if (h['field_name'] != null)
                          Text('${h['field_name']}: “${h['old_value'] ?? '—'}” → “${h['new_value'] ?? '—'}”', style: _small)
                        else if (h['summary'] != null)
                          Text('${h['summary']}', style: _small),
                      ]),
                    ),
                ]),
            ],
          ),
        );
      },
    );
  }
}

const _small = TextStyle(fontSize: 12, color: Brand.muted);

class _VoucherLink extends StatelessWidget {
  const _VoucherLink({required this.id, required this.label});
  final int id;
  final String label;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () => openScreen(context, FinVoucherScreen(entryId: id)),
        child: Text(label, style: const TextStyle(color: Brand.primaryActive, fontWeight: FontWeight.w700)),
      );
}

// ── New journal form ─────────────────────────────────────────────────────────

class _JLine {
  int? ledgerId;
  String? ledgerLabel;
  bool isControl = false;
  bool costObjectRequired = false;
  bool hasDefaultCc = false;
  String? party;
  String? partyLabel;
  int? ccId;
  String? ccLabel;
  int? ioId;
  String? ioLabel;
  final debit = TextEditingController();
  final credit = TextEditingController();
  final remarks = TextEditingController();
  double get dr => double.tryParse(debit.text) ?? 0;
  double get cr => double.tryParse(credit.text) ?? 0;
}

/// New Journal (portal JournalForm): saved as a draft, then sent to its
/// approvers when the user may submit. True when saved.
Future<bool> showJournalForm(BuildContext context) async {
  DateTime postingDate = DateTime.now();
  String postingType = 'adjustment';
  DateTime? autoReverseOn;
  final desc = TextEditingController();
  final lines = [_JLine(), _JLine()];
  final proof = <PickedProof>[];
  final rules = await ProofRules.load();
  final ledgers = await FinLookups.ledgers().catchError((_) => <Json>[]);
  Json? ledgerById(int? id) {
    for (final a in ledgers) {
      if (toInt(a['id']) == id) return a;
    }
    return null;
  }

  String? warning;
  if (!context.mounted) return false;
  final saved = await showFormSheet(
    context,
    title: 'New Journal',
    saveLabel: 'Save Draft',
    builder: (ctx, setS) {
      final totalDr = lines.fold<double>(0, (s, l) => s + l.dr);
      final totalCr = lines.fold<double>(0, (s, l) => s + l.cr);
      final diff = round2(totalDr - totalCr);
      return [
        const Text('Saved as a draft — another finance user posts it (maker-checker).', style: TextStyle(color: Brand.muted)),
        const InfoBanner(
            'Use a journal only for entries no document covers — accruals, provisions, corrections, depreciation. Invoices, notes and payments '
            'post their own entries. Every journal must balance: total debits = total credits.'),
        const Caps('Voucher'),
        DateField(
          label: 'Posting Date',
          required: true,
          value: postingDate,
          onChanged: (d) => setS(() {
            if (d == null) return;
            postingDate = d;
            if (postingType == 'accrual') autoReverseOn = isoToDate(_firstOfNextMonth(d));
          }),
        ),
        AppSelect<String>(
          label: 'Posting Type',
          required: true,
          value: postingType,
          options: [for (final t in _manualTypes) Option(t, kPostingLabels[t] ?? t)],
          onChanged: (o) => setS(() {
            postingType = o?.value ?? 'adjustment';
            if (postingType == 'accrual' && autoReverseOn == null) autoReverseOn = isoToDate(_firstOfNextMonth(postingDate));
            if (postingType != 'accrual') autoReverseOn = null;
          }),
        ),
        if (postingType == 'accrual') ...[
          DateField(label: 'Auto-reverse On', value: autoReverseOn, onChanged: (d) => setS(() => autoReverseOn = d)),
          const Text(
              'An accrual books an expense or income in the month it belongs to, before the bill arrives. When posted, a reversal is '
              'automatically posted on the auto-reverse date (normally the 1st of next month), so the real bill isn\'t counted twice.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ],
        Row(children: [
          Caps('Lines (${lines.length})'),
          const Spacer(),
          const Text('Debit or credit on each line — never both', style: TextStyle(fontSize: 11.5, color: Brand.muted)),
        ]),
        for (var i = 0; i < lines.length; i++)
          _JournalLineCard(
            key: ObjectKey(lines[i]),
            index: i,
            line: lines[i],
            setS: setS,
            ledgerById: ledgerById,
            onRemove: lines.length > 2 ? () => setS(() => lines.removeAt(i)) : null,
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
              onPressed: () => setS(() => lines.add(_JLine())),
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Add line')),
        ),
        ProofPicker(
          entityType: 'journal',
          value: proof,
          setState: setS,
          required: rules.journal,
          hint: 'The working, calculation or approval mail behind this entry — auditors ask for it on every manual journal.',
        ),
        const Text(
            'A party control account (Sundry Debtors / Creditors) needs the vendor or customer on its line, and an overhead ledger needs the cost '
            'centre or internal order that bears the cost. Once saved, the draft is sent to its approvers if you may submit journals.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        AppTextField(label: 'Description / Narration', controller: desc, maxLines: 3, hint: 'What is this entry for?'),
        const Caps('Totals'),
        Column(children: [
          AmountRow('Total debit', inr(totalDr), bold: true),
          AmountRow('Total credit', inr(totalCr), bold: true),
          const SizedBox(height: 6),
          Align(
            alignment: Alignment.centerLeft,
            child: StatusBadge(
              diff.abs() < 0.005 ? 'Balanced' : 'Difference: ${inr(diff.abs())} ${diff > 0 ? 'more Dr' : 'more Cr'}',
              color: diff.abs() < 0.005 ? Brand.success : Brand.danger,
            ),
          ),
        ]),
      ];
    },
    onSave: () async {
      final totalDr = lines.fold<double>(0, (s, l) => s + l.dr);
      final totalCr = lines.fold<double>(0, (s, l) => s + l.cr);
      final diff = round2(totalDr - totalCr);
      if (!(diff.abs() < 0.005 && totalDr > 0)) {
        throw totalDr <= 0
            ? 'Enter the debit and credit amounts — a journal needs at least one debit and one credit.'
            : 'The journal does not balance: difference ${inr(diff.abs())} ${diff > 0 ? 'more Dr' : 'more Cr'}. Total debits must equal total credits.';
      }
      final used = lines.where((l) => l.ledgerId != null || l.dr != 0 || l.cr != 0).toList();
      for (final l in used) {
        if (l.dr != 0 && l.cr != 0) throw 'Each line takes a debit or a credit — never both. Clear one of them.';
        if (l.ledgerId == null) throw 'Pick the ledger on every line that has an amount.';
      }
      for (final l in used) {
        final a = ledgerById(l.ledgerId);
        if (a?['is_control_account'] == true && l.party == null) {
          throw '${a!['code']} — ${a['name']} is a party control account: pick the vendor or customer on that line so their ledger stays in step with the control account.';
        }
      }
      for (final l in used) {
        final a = ledgerById(l.ledgerId);
        if (a?['cost_object_required'] == true && a?['default_cost_center_id'] == null && l.ccId == null && l.ioId == null) {
          throw '${a!['code']} — ${a['name']} is an overhead ledger: pick the cost centre that bears this cost, or the internal order it is spent on.';
        }
      }
      if (rules.journal && proof.isEmpty) {
        throw "Attach the working or approval under Supporting documents — a manual journal can't go for approval without it.";
      }
      final created = asJson(await Api.post('/accounts/journal-entries', data: {
        'posting_date': apiDate(postingDate),
        'posting_type': postingType,
        'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
        'auto_reverse_on': postingType == 'accrual' && autoReverseOn != null ? apiDate(autoReverseOn!) : null,
        'lines': [
          for (final l in used)
            {
              'gl_account_id': l.ledgerId ?? 0,
              'debit_amount': l.dr,
              'credit_amount': l.cr,
              'cost_center_id': l.ccId,
              'internal_order_id': l.ioId,
              'vendor_id': l.party != null && l.party!.startsWith('v:') ? int.tryParse(l.party!.substring(2)) : null,
              'customer_id': l.party != null && l.party!.startsWith('c:') ? int.tryParse(l.party!.substring(2)) : null,
              'remarks': l.remarks.text.trim().isEmpty ? null : l.remarks.text.trim(),
            },
        ],
      }));
      final id = toInt(created['id'])!;
      final proofError = proof.isEmpty ? '' : await uploadPickedProof('journal', id, proof, 'The journal');
      if (proofError.isNotEmpty) {
        warning = proofError;
        return;
      }
      if (finCan('journal_vouchers', 'submit')) {
        warning = await submitAfterSave(() => Api.post('/accounts/journal-entries/$id/submit'), 'The journal');
      }
    },
  );
  if (saved && context.mounted) {
    showSnack(context, (warning ?? '').isEmpty ? 'Draft journal saved.' : warning!, error: (warning ?? '').isNotEmpty);
  }
  return saved;
}

class _JournalLineCard extends StatelessWidget {
  const _JournalLineCard({super.key, required this.index, required this.line, required this.setS, required this.ledgerById, this.onRemove});
  final int index;
  final _JLine line;
  final StateSetter setS;
  final Json? Function(int?) ledgerById;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final l = line;
    final acct = ledgerById(l.ledgerId);
    final ccRequired = acct?['cost_object_required'] == true && acct?['default_cost_center_id'] == null && l.ioId == null;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text('Line ${index + 1}', style: const TextStyle(fontWeight: FontWeight.w700)),
          const Spacer(),
          if (onRemove != null)
            IconButton(icon: const Icon(Icons.close_rounded, size: 18, color: Brand.danger), onPressed: onRemove),
        ]),
        AppSelect<int>(
          label: 'Ledger',
          value: l.ledgerId,
          valueLabel: l.ledgerLabel,
          loadOptions: (q) async => (await FinLookups.ledgerOptions())
              .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
              .toList(),
          onChanged: (o) => setS(() {
            l.ledgerId = o?.value;
            l.ledgerLabel = o?.label;
            if (ledgerById(o?.value)?['is_control_account'] != true) {
              l.party = null;
              l.partyLabel = null;
            }
          }),
        ),
        const SizedBox(height: 8),
        if (acct?['is_control_account'] == true) ...[
          AppSelect<String>(
            label: 'Party (control a/c)',
            required: true,
            value: l.party,
            valueLabel: l.partyLabel,
            loadOptions: partyOptions,
            onChanged: (o) => setS(() {
              l.party = o?.value;
              l.partyLabel = o?.label;
            }),
          ),
          const SizedBox(height: 8),
        ],
        Row(children: [
          Expanded(
            child: AppTextField(
              label: 'Debit (₹)',
              controller: l.debit,
              keyboardType: AppTextField.number,
              onChanged: (v) => setS(() {
                if (v.isNotEmpty) l.credit.clear();
              }),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: AppTextField(
              label: 'Credit (₹)',
              controller: l.credit,
              keyboardType: AppTextField.number,
              onChanged: (v) => setS(() {
                if (v.isNotEmpty) l.debit.clear();
              }),
            ),
          ),
        ]),
        const SizedBox(height: 8),
        AppSelect<int>(
          label: ccRequired ? 'Cost Centre (required)' : 'Cost Centre',
          value: l.ccId,
          valueLabel: l.ccLabel,
          loadOptions: (q) async => (await FinLookups.costCentres())
              .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
              .toList(),
          onChanged: (o) => setS(() {
            l.ccId = o?.value;
            l.ccLabel = o?.label;
          }),
        ),
        const SizedBox(height: 8),
        AppSelect<int>(
          label: 'Internal Order',
          value: l.ioId,
          valueLabel: l.ioLabel,
          loadOptions: (q) async => (await FinLookups.internalOrders())
              .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
              .toList(),
          onChanged: (o) => setS(() {
            l.ioId = o?.value;
            l.ioLabel = o?.label;
          }),
        ),
        const SizedBox(height: 8),
        AppTextField(label: 'Remarks', controller: l.remarks),
      ]),
    );
  }
}

// ── Day book ─────────────────────────────────────────────────────────────────

class _DayBook extends StatefulWidget {
  const _DayBook();

  @override
  State<_DayBook> createState() => _DayBookState();
}

class _DayBookState extends State<_DayBook> {
  DateTime? _from = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime? _to = DateTime.now();
  String? _type;
  int _tick = 0;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        const InfoBanner(
            'The Day Book lists every posted voucher in date order — the chronological record of all transactions, used to check that nothing was missed or entered twice.'),
        DateRangeRow(from: _from, to: _to, onChanged: (f, t) => setState(() {
              _from = f;
              _to = t;
            })),
        padded(Row(children: [
          Expanded(
            child: AppSelect<String>(
              label: 'Voucher Type',
              value: _type,
              options: [for (final e in kVoucherLabels.entries) Option(e.key, e.value)],
              onChanged: (o) => setState(() => _type = o?.value),
            ),
          ),
          const SizedBox(width: 8),
          actionBtn('Show', () => setState(() => _tick++), primary: true),
        ])),
        ApiLoader<Json>(
          key: ValueKey('db$_tick'),
          load: () async => asJson(await Api.get('/accounts/reports/day-book',
              query: {'from_date': dateOrNull(_from), 'to_date': dateOrNull(_to), 'voucher_type': _type})),
          builder: (ctx, d, _) {
            final entries = listOf(d['entries']);
            if (entries.isEmpty) return const EmptyView('No vouchers posted in this range.');
            double dr = 0, cr = 0;
            for (final e in entries) {
              for (final l in listOf(e['lines'])) {
                dr += toD(l['debit_amount']);
                cr += toD(l['credit_amount']);
              }
            }
            return Column(children: [
              for (final e in entries)
                RecordCard(
                  code: '${e['entry_number']}',
                  title: '${fmtDate(e['posting_date'])} · ${kVoucherLabels['${e['voucher_type']}'] ?? e['voucher_type']}',
                  subtitle: (e['description'] ?? '').toString().isEmpty ? null : '${e['description']}',
                  status: e['status'] == 'reversed' ? 'Reversed' : null,
                  meta: [
                    for (final l in listOf(e['lines']))
                      (
                        '${toD(l['credit_amount']) > 0 ? 'To ' : ''}${l['gl_account_code']} — ${l['gl_account_name']}',
                        toD(l['debit_amount']) > 0 ? 'Dr ${inr(l['debit_amount'])}' : 'Cr ${inr(l['credit_amount'])}'
                      ),
                  ],
                  onTap: () => openScreen(ctx, FinVoucherScreen(entryId: toInt(e['journal_entry_id'])!)),
                ),
              DetailSection('Total — ${entries.length} voucher(s), value ${inr(d['total'])}', children: [
                AmountRow('Dr', inr(dr), bold: true),
                AmountRow('Cr', inr(cr), bold: true),
              ]),
            ]);
          },
        ),
      ],
    );
  }
}

// ── Ledger statement ─────────────────────────────────────────────────────────

class _LedgerStatement extends StatefulWidget {
  const _LedgerStatement();

  @override
  State<_LedgerStatement> createState() => _LedgerStatementState();
}

class _LedgerStatementState extends State<_LedgerStatement> {
  int? _ledger;
  String? _ledgerLabel;
  DateTime? _from = fyStart();
  DateTime? _to = DateTime.now();
  int _tick = 0;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        const InfoBanner(
            'A ledger statement shows the opening balance, every posting in the period and the running balance. Dr balances are normal for assets and expenses; Cr for liabilities, capital and income.'),
        padded(AppSelect<int>(
          label: 'Ledger',
          value: _ledger,
          valueLabel: _ledgerLabel,
          loadOptions: (q) async {
            final all = await FinLookups.ledgers();
            return [
              for (final a in all)
                if (a['status'] == 'active' &&
                    (q.isEmpty || '${a['code']} ${a['name']}'.toLowerCase().contains(q.toLowerCase())))
                  Option<int>(toInt(a['id'])!, '${a['code']} — ${a['name']}', subtitle: a['group_name'] as String?),
            ];
          },
          onChanged: (o) => setState(() {
            _ledger = o?.value;
            _ledgerLabel = o?.label;
            _tick++;
          }),
        )),
        DateRangeRow(from: _from, to: _to, onChanged: (f, t) => setState(() {
              _from = f;
              _to = t;
            })),
        padded(Align(
            alignment: Alignment.centerRight,
            child: actionBtn('Show', _ledger == null ? null : () => setState(() => _tick++), primary: true))),
        if (_ledger == null)
          const EmptyView('Pick a ledger to see its statement.')
        else
          ApiLoader<Json>(
            key: ValueKey('ls$_tick'),
            load: () async => asJson(await Api.get('/accounts/reports/gl-ledger',
                query: {'gl_account_id': _ledger, 'from_date': dateOrNull(_from), 'to_date': dateOrNull(_to)})),
            builder: (ctx, d, _) => FinLedgerStatementView(data: d, emptyText: 'No postings to this ledger in the range.'),
          ),
      ],
    );
  }
}

/// Opening, postings with running balance and closing of one ledger
/// (GLLedger shape) - also used by other Finance screens.
class FinLedgerStatementView extends StatelessWidget {
  const FinLedgerStatementView({super.key, required this.data, this.emptyText = 'No postings in the range.'});
  final Json data;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    final rows = listOf(data['rows']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      StatGrid([
        StatCard('Opening', '₹ ${drcr(data['opening_balance'])}'),
        StatCard('Total Dr', inr(data['total_debit'])),
        StatCard('Total Cr', inr(data['total_credit'])),
        StatCard('Closing', '₹ ${drcr(data['closing_balance'])}'),
      ]),
      RecordCard(
        title: 'Opening balance',
        subtitle: fmtDate(data['from_date']),
        trailing: Text(drcr(data['opening_balance']), style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
      if (rows.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(emptyText, style: const TextStyle(color: Brand.muted))),
      for (final r in rows)
        RecordCard(
          code: '${r['entry_number']}',
          title: (r['description'] ?? '').toString().isEmpty ? '—' : '${r['description']}',
          subtitle: '${fmtDate(r['posting_date'])} · ${kVoucherLabels['${r['voucher_type']}'] ?? r['voucher_type']}',
          meta: [
            if (toD(r['debit_amount']) != 0) ('Dr', inr(r['debit_amount'])),
            if (toD(r['credit_amount']) != 0) ('Cr', inr(r['credit_amount'])),
            ('Balance', drcr(r['running_balance'])),
          ],
          onTap: r['journal_entry_id'] == null
              ? null
              : () => openScreen(context, FinVoucherScreen(entryId: toInt(r['journal_entry_id'])!)),
        ),
      DetailSection('Totals / closing balance on ${fmtDate(data['to_date'])}', children: [
        AmountRow('Dr', inr(data['total_debit']), bold: true),
        AmountRow('Cr', inr(data['total_credit']), bold: true),
        AmountRow('Closing', drcr(data['closing_balance']), bold: true),
      ]),
    ]);
  }
}

// ── Period close ─────────────────────────────────────────────────────────────

List<String> _recentPeriods([int n = 18]) {
  final d = DateTime.now();
  return [
    for (var i = 0; i < n; i++)
      () {
        final x = DateTime(d.year, d.month - i, 1);
        return '${x.year}-${x.month.toString().padLeft(2, '0')}';
      }(),
  ];
}

const _openClosed = {'open': 'Open', 'closed': 'Closed'};
const _openClosedHex = {'open': Color(0xFF16A34A), 'closed': Color(0xFF64748B)};

class _PeriodClose extends StatefulWidget {
  const _PeriodClose();

  @override
  State<_PeriodClose> createState() => _PeriodCloseState();
}

class _PeriodCloseState extends State<_PeriodClose> {
  String _period = currentPeriod();
  int _tick = 0;
  bool _busy = false;

  bool get _canClose => finCan('period_close', 'approve');
  bool get _closesDirectly => isFinanceManager;
  bool get _isAdmin => Perm.user['role'] == 'admin';

  Future<void> _close() async {
    final notes = await promptDialog(context,
        title: 'Close accounting period ${periodLabel(_period)}?',
        message: 'No further postings will be allowed with a date in this month.',
        label: 'Notes',
        required: false,
        confirmLabel: _closesDirectly ? 'Close Period' : 'Request Close');
    if (notes == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final out = asJson(await Api.post('/accounts/period-close/$_period/close', data: {'notes': notes.isEmpty ? null : notes}));
      if (mounted && out['approval_status'] == 'pending' && out['message'] != null) showSnack(context, '${out['message']}');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not close ${periodLabel(_period)}. ${ApiClient.describe(e)}', error: true);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _tick++;
        });
      }
    }
  }

  Future<void> _reopen() async {
    final reason = await promptDialog(context,
        title: 'Reopen accounting period ${periodLabel(_period)}?',
        message:
            'Reopening allows postings into a month whose reports may already have been shared. The reason goes on the audit trail.',
        label: 'Reason for reopening',
        confirmLabel: 'Reopen Period');
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    await runAction(context, () => Api.post('/accounts/period-close/$_period/reopen', data: {'reason': reason}),
        success: '${periodLabel(_period)} reopened.');
    if (mounted) {
      setState(() {
        _busy = false;
        _tick++;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<List<Json>>(
      key: ValueKey('pc$_tick'),
      load: () async => asRows(await Api.get('/accounts/period-close')),
      builder: (ctx, periods, reload) {
        Json? row;
        for (final p in periods) {
          if (p['accounting_period'] == _period) row = p;
        }
        final isClosed = row?['status'] == 'closed';
        final pending = row?['approval_status'] == 'pending';
        return ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            const InfoBanner(
                'Closing a month locks it: nothing more can be posted with a date in it, so reports for that month stop changing. To close, every '
                'document dated in the month (invoices, notes, payment vouchers, journals) must be posted — drafts left behind block the close. '
                'Closing goes through the approval workflow (Organization › Approval Workflows › Accounting period close): a Finance '
                'Manager\'s click closes it at once; anyone else\'s request waits for a Finance Manager. Only an admin can reopen, with a reason.'),
            DetailSection('Accounting Period', children: [
              AppSelect<String>(
                label: 'Accounting Period',
                value: _period,
                clearable: false,
                options: [for (final p in _recentPeriods()) Option(p, periodLabel(p))],
                onChanged: (o) => setState(() => _period = o?.value ?? _period),
              ),
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                FinStatusPill(isClosed ? 'closed' : 'open', labels: _openClosed, colors: _openClosedHex),
                if (isClosed && row?['closed_by_name'] != null)
                  Text('by ${row!['closed_by_name']} on ${fmtDate(row['closed_at'])}', style: _small),
                if (!isClosed) ApprovalBadge(status: row?['approval_status'] as String?, stage: row?['approval_stage'] as String?),
              ]),
              const SizedBox(height: 10),
              if (!isClosed)
                _canClose
                    ? actionBtn(
                        _closesDirectly
                            ? 'Close ${periodLabel(_period)}'
                            : pending
                                ? 'Close requested'
                                : 'Request close of ${periodLabel(_period)}',
                        _busy || (pending && !_closesDirectly) ? null : _close,
                        primary: true)
                    : const Text('You need the Approve permission on Period Close to close a period.', style: _small),
              if (isClosed)
                _isAdmin
                    ? actionBtn('Reopen', _busy ? null : _reopen, danger: true)
                    : const Text('Only an admin can reopen a closed period.', style: _small),
            ]),
            ApprovalPanel(
              key: ValueKey('ap$_period$_tick'),
              entityType: 'accounts_period_close',
              entityId: int.parse(_period.replaceAll('-', '')),
              title: 'Approval — close ${periodLabel(_period)}',
              onChanged: () => setState(() => _tick++),
            ),
            SectionTitle('Periods (${periods.length})'),
            if (periods.isEmpty) const EmptyView('No period has been closed yet.'),
            for (final p in periods)
              RecordCard(
                title: periodLabel('${p['accounting_period']}'),
                trailing: Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    FinStatusPill(p['status'], labels: _openClosed, colors: _openClosedHex),
                    if (p['status'] != 'closed')
                      ApprovalBadge(status: p['approval_status'] as String?, stage: p['approval_stage'] as String?),
                  ]),
                ),
                meta: [
                  ('Closed By', p['closed_by_name'] != null ? '${p['closed_by_name']} · ${fmtDate(p['closed_at'])}' : '—'),
                  ('Notes', txt(p['close_notes'])),
                  (
                    'Reopened',
                    p['reopened_by_name'] != null
                        ? '${p['reopened_by_name']} · ${fmtDate(p['reopened_at'])} — ${p['reopen_reason'] ?? ''}'
                        : '—'
                  ),
                ],
                onTap: () => setState(() => _period = '${p['accounting_period']}'),
              ),
          ],
        );
      },
    );
  }
}
