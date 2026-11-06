import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';
import 'fin_journals.dart';
import 'fin_payments.dart' show kModeLabels;

/// Finance › Bank & Cash (portal finance/banking + BankStatementPanel,
/// CashPositionTab, GuaranteesTab).
class FinBankingPage extends StatelessWidget {
  const FinBankingPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Bank & Cash',
        subtitle: 'Bank and cash balances straight from the ledger, the bank/cash book, bank reconciliation and the cash forecast.',
        tabs: [
          FinSubTab('Accounts', (_) => const _Accounts(), permTab: 'bank_book'),
          FinSubTab('Bank / Cash Book', (_) => const _Book(), permTab: 'bank_book'),
          FinSubTab('Reconciliation (BRS)', (_) => const _Recons(), permTab: 'reconciliation'),
          FinSubTab('Liquidity Forecast', (_) => const _Liquidity(), permTab: 'liquidity'),
          FinSubTab('Guarantees & EMD', (_) => const _Guarantees(), permTab: 'guarantees'),
        ],
      );
}

const _kindLabels = {'bank': 'Bank', 'cash': 'Cash'};
const _kindHex = {'bank': Color(0xFF2563EB), 'cash': Color(0xFF16A34A)};

String _acctLabel(Json b) =>
    b['account_kind'] == 'cash' ? '${b['bank_name']}' : '${b['bank_name']}${(b['account_no'] ?? '').toString().isNotEmpty ? ' — ${b['account_no']}' : ''}';

Future<List<Json>> _accounts() async => asRows(await Api.get('/accounts/bank-accounts', query: {'status': 'active'}));

// ── Accounts ─────────────────────────────────────────────────────────────────

class _Accounts extends StatefulWidget {
  const _Accounts();

  @override
  State<_Accounts> createState() => _AccountsState();
}

class _AccountsState extends State<_Accounts> {
  String? _kind;

  @override
  Widget build(BuildContext context) => ApiLoader<List<Json>>(
        load: _accounts,
        builder: (ctx, accounts, _) {
          double total(String k) => accounts.where((a) => a['account_kind'] == k).fold(0.0, (s, a) => s + toD(a['book_balance']));
          final shown = _kind == null ? accounts : accounts.where((a) => a['account_kind'] == _kind).toList();
          return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            const InfoBanner(
                "Balances are the book balance — each account's GL ledger, i.e. what our books say. The bank's own figure can "
                'differ until cheques clear; the Reconciliation (BRS) tab explains that difference. Accounts are added under Finance → Masters.'),
            if (accounts.isNotEmpty)
              StatGrid([
                StatCard('Total at Bank', inr(total('bank')), active: _kind == 'bank', onTap: () => setState(() => _kind = _kind == 'bank' ? null : 'bank')),
                StatCard('Total Cash in Hand', inr(total('cash')), active: _kind == 'cash', onTap: () => setState(() => _kind = _kind == 'cash' ? null : 'cash')),
                StatCard('Total Liquid Funds', inr(total('bank') + total('cash')), onTap: () => setState(() => _kind = null)),
              ]),
            if (accounts.isEmpty) const EmptyView('No active bank or cash accounts. Add one under Finance → Masters → Bank & Cash.'),
            for (final a in shown)
              RecordCard(
                title: '${a['bank_name']}',
                subtitle: a['account_kind'] == 'bank'
                    ? '${a['account_no'] ?? 'No account number'}${a['ifsc_code'] != null ? ' · ${a['ifsc_code']}' : ''}${a['branch_name'] != null ? ' · ${a['branch_name']}' : ''}'
                    : null,
                trailing: FinStatusPill(a['account_kind'], labels: _kindLabels, colors: _kindHex),
                meta: [
                  ('Book balance', drcr(a['book_balance'])),
                  ('Ledger', a['gl_account_code'] != null ? '${a['gl_account_code']}' : 'No GL ledger linked'),
                ],
                onTap: a['gl_account_id'] == null
                    ? null
                    : () => openScreen(ctx, SubPage(title: 'Open ${a['account_kind'] == 'cash' ? 'cash' : 'bank'} book', body: _Book(initial: a))),
              ),
          ]);
        },
      );
}

// ── Book ─────────────────────────────────────────────────────────────────────

class _Book extends StatefulWidget {
  const _Book({this.initial});
  final Json? initial;

  @override
  State<_Book> createState() => _BookState();
}

class _BookState extends State<_Book> {
  Json? _acct;
  DateTime? _from = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime? _to = DateTime.now();
  int _tick = 0;

  @override
  void initState() {
    super.initState();
    _acct = widget.initial;
  }

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      InfoBanner(
          'The bank/cash book is the account\'s ledger: receipts on the Dr side, payments on the Cr side, with a running balance.'
          "${_acct?['account_kind'] == 'cash' ? " Cash can never go negative — you cannot pay out cash you don't hold, so a payment that would take the cash balance below zero is refused; record the receipt or withdrawal first." : ''}"),
      padded(AppSelect<int>(
        label: 'Bank / Cash Account',
        value: toInt(_acct?['id']),
        valueLabel: _acct == null ? null : '${_kindLabels[_acct!['account_kind']]} · ${_acctLabel(_acct!)}',
        loadOptions: (q) async {
          final rows = await _accounts();
          return [
            for (final a in rows)
              if (q.isEmpty || _acctLabel(a).toLowerCase().contains(q.toLowerCase()))
                Option(toInt(a['id'])!, '${_kindLabels[a['account_kind']]} · ${_acctLabel(a)}'),
          ];
        },
        onChanged: (o) async {
          if (o == null) return setState(() => _acct = null);
          final rows = await _accounts();
          setState(() {
            _acct = rows.firstWhere((a) => toInt(a['id']) == o.value, orElse: () => {'id': o.value});
            _tick++;
          });
        },
      )),
      DateRangeRow(from: _from, to: _to, onChanged: (f, t) => setState(() {
            _from = f;
            _to = t;
            _tick++;
          })),
      if (_acct == null)
        const EmptyView('Pick a bank or cash account to see its book.')
      else if (_acct!['gl_account_id'] == null)
        padded(ErrorBanner('${_acct!['bank_name']} has no GL ledger linked, so it has no book. Link one under Finance → Masters → Bank Accounts.'))
      else
        ApiLoader<Json>(
          key: ValueKey('bk$_tick'),
          load: () async => asJson(await Api.get('/accounts/reports/gl-ledger',
              query: {'gl_account_id': _acct!['gl_account_id'], 'from_date': dateOrNull(_from), 'to_date': dateOrNull(_to)})),
          builder: (ctx, d, _) => FinLedgerStatementView(data: d, emptyText: 'No receipts or payments in this range.'),
        ),
    ]);
  }
}

// ── Reconciliation ───────────────────────────────────────────────────────────

const _reconLabels = {'in_progress': 'In Progress', 'completed': 'Completed'};
const _reconHex = {'in_progress': Color(0xFFF59E0B), 'completed': Color(0xFF16A34A)};
const _dirLabels = {'in': 'Deposit', 'out': 'Withdrawal'};
const _dirHex = {'in': Color(0xFF16A34A), 'out': Color(0xFFDC2626)};

class _Recons extends StatefulWidget {
  const _Recons();

  @override
  State<_Recons> createState() => _ReconsState();
}

class _ReconsState extends State<_Recons> {
  final _list = GlobalKey<ApiListViewState>();

  Future<void> _start() async {
    List<Json> banks;
    try {
      banks = (await _accounts()).where((a) => a['account_kind'] == 'bank').toList();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    int? bankId;
    DateTime date = DateTime.now();
    final bal = TextEditingController();
    Json? recon;
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'Start a reconciliation',
      saveLabel: 'Start reconciliation',
      builder: (ctx, setS) => [
        const Text("Reconcile our bank book with the bank's statement for one date.", style: TextStyle(color: Brand.muted)),
        AppSelect<int>(
          label: 'Bank account',
          required: true,
          value: bankId,
          options: [for (final b in banks) Option(toInt(b['id'])!, '${_acctLabel(b)} · book ${drcr(b['book_balance'])}')],
          onChanged: (o) => setS(() => bankId = o?.value),
        ),
        DateField(label: 'Statement date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
        AppTextField(
            label: 'Statement closing balance (₹)',
            required: true,
            controller: bal,
            hint: 'As per bank',
            keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true)),
      ],
      onSave: () async {
        if (bankId == null) throw 'Pick the bank account whose statement you are reconciling.';
        final v = double.tryParse(bal.text.trim());
        if (v == null) throw 'Enter the closing balance shown on the bank statement for the statement date.';
        recon = asJson(await Api.post('/accounts/bank-reconciliations',
            data: {'bank_account_id': bankId, 'statement_date': apiDate(date), 'statement_balance': v}));
      },
    );
    if (ok && recon != null && mounted) {
      _list.currentState?.reload();
      await openReconScreen(context, toInt(recon!['id'])!);
      _list.currentState?.reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCan('reconciliation', 'create') ? CreateFab(label: 'Start reconciliation', onPressed: _start) : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async => ApiPage(asRows(await Api.get('/accounts/bank-reconciliations'))),
        header: const InfoBanner(
            "A Bank Reconciliation Statement explains why our book balance differs from the bank statement: cheques we issued "
            "that the bank hasn't paid yet (outstanding cheques) and deposits the bank hasn't credited yet (deposits in transit). Tick each "
            'voucher that appears on the statement with its bank date. Bank charges, interest or direct credits seen on the statement but missing '
            'from the books must first be entered as payment/receipt vouchers — then the difference becomes zero and the BRS can be completed.'),
        emptyText: 'No reconciliation started yet.',
        itemBuilder: (ctx, r, reload) => RecordCard(
          title: '${r['bank_account_label']}',
          subtitle: 'Statement as on ${fmtDate(r['statement_date'])}',
          trailing: FinStatusPill(r['status'], labels: _reconLabels, colors: _reconHex),
          meta: [
            ('Book', inr(r['book_balance'])),
            ('Statement', inr(r['statement_balance'])),
            ('Difference', inr(r['difference'])),
          ],
          onTap: () async {
            await openReconScreen(ctx, toInt(r['id'])!);
            reload();
          },
        ),
      ),
    );
  }
}

Future<void> openReconScreen(BuildContext context, int id) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => _ReconScreen(id: id)));

class _ReconScreen extends StatefulWidget {
  const _ReconScreen({required this.id});
  final int id;

  @override
  State<_ReconScreen> createState() => _ReconScreenState();
}

class _ReconScreenState extends State<_ReconScreen> {
  int _tick = 0;
  final _selected = <int>{};
  DateTime? _cleared;
  bool _busy = false;

  Future<(Json, List<Json>)> _load() async {
    final r = asJson(await Api.get('/accounts/bank-reconciliations/${widget.id}'));
    final items = r['status'] == 'completed'
        ? <Json>[]
        : asRows(await Api.get('/accounts/bank-reconciliations/${widget.id}/unreconciled-payments'));
    return (r, items);
  }

  Future<void> _match() async {
    setState(() => _busy = true);
    final ok = await runAction(
        context,
        () => Api.post('/accounts/bank-reconciliations/${widget.id}/reconcile-payments',
            data: {'payment_transaction_ids': _selected.toList(), 'cleared_date': dateOrNull(_cleared)}),
        success: 'Selected vouchers marked as cleared.');
    if (mounted) {
      setState(() {
        _busy = false;
        if (ok) {
          _selected.clear();
          _tick++;
        }
      });
    }
  }

  Future<void> _complete() async {
    final ok = await confirmDialog(context,
        title: 'Complete this reconciliation?',
        message: 'The BRS is locked as a record of this statement date. Vouchers ticked as cleared stay cleared.',
        confirmLabel: 'Complete');
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.post('/accounts/bank-reconciliations/${widget.id}/complete'), success: 'Reconciliation completed.')) {
      setState(() => _tick++);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<(Json, List<Json>)>(
      key: ValueKey(_tick),
      load: _load,
      builder: (ctx, data, reload) {
        final (r, items) = data;
        final balanced = toD(r['difference']).abs() < 0.005;
        final open = r['status'] != 'completed';
        final canEdit = finCan('reconciliation', 'edit');
        final canComplete = finCanFeature('reconciliation', 'completion', 'approve');
        double selTotal = 0;
        for (final p in items) {
          if (_selected.contains(toInt(p['id']))) selTotal += (p['direction'] == 'out' ? -1 : 1) * toD(p['amount']);
        }
        final actions = <Widget>[
          if (open && canEdit && _selected.isNotEmpty)
            actionBtn('Mark ${_selected.length} cleared', _busy ? null : _match, primary: true),
          if (open && canComplete) actionBtn('Complete Reconciliation', _busy || !balanced ? null : _complete, primary: _selected.isEmpty),
        ];
        return SubPage(
          title: 'BRS — ${fmtDate(r['statement_date'])}',
          bottom: actions.isEmpty ? null : ActionBar(actions),
          body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            DetailSection('${r['bank_account_label']} — statement as on ${fmtDate(r['statement_date'])}',
                action: FinStatusPill(r['status'], labels: _reconLabels, colors: _reconHex),
                children: [
                  if (r['status'] == 'completed' && r['completed_by_name'] != null)
                    Text('Completed by ${r['completed_by_name']} on ${fmtDate(r['completed_at'])}',
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  AmountRow('Balance as per books', inr(r['book_balance'])),
                  AmountRow('Add: cheques issued, not yet paid by bank', '+ ${inr(r['outstanding_cheques'])}'),
                  AmountRow('Less: deposits not yet credited by bank', '− ${inr(r['deposits_in_transit'])}'),
                  AmountRow('Expected balance as per bank', inr(r['reconciled_balance']), bold: true),
                  AmountRow('Balance as per bank statement', inr(r['statement_balance'])),
                  AmountRow('Difference ${balanced ? '(reconciled)' : '(must be 0 to complete)'}', inr(r['difference']),
                      bold: true, color: balanced ? const Color(0xFF15803D) : const Color(0xFFB91C1C)),
                ]),
            if (finCanFeature('reconciliation', 'bank_statements', 'view'))
              _StatementPanel(recon: r, onChanged: () => setState(() => _tick++)),
            if (open) ...[
              SectionTitle('Uncleared vouchers (${items.length})'),
              if (items.isEmpty) padded(const Text('Every voucher on this account is cleared.', style: TextStyle(color: Brand.muted))),
              for (final p in items)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Card(
                    child: CheckboxListTile(
                      value: _selected.contains(toInt(p['id'])),
                      onChanged: canEdit
                          ? (v) => setState(() => v == true ? _selected.add(toInt(p['id'])!) : _selected.remove(toInt(p['id'])))
                          : null,
                      title: Text('${p['payment_number']} · ${inr(p['amount'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text([
                        fmtDate(p['payment_date']),
                        _dirLabels['${p['direction']}'] ?? '',
                        '${p['party_name'] ?? p['narration'] ?? ''}',
                        kModeLabels['${p['payment_mode']}'] ?? '${p['payment_mode'] ?? ''}',
                        '${p['cheque_number'] ?? p['reference_no'] ?? ''}',
                      ].where((x) => x.isNotEmpty).join(' · ')),
                      secondary: Icon(p['direction'] == 'out' ? Icons.call_made_rounded : Icons.call_received_rounded,
                          color: _dirHex['${p['direction']}']),
                    ),
                  ),
                ),
              if (canEdit && items.isNotEmpty)
                padded(DateField(
                    label: 'Bank (clearing) date — blank = statement date', value: _cleared, onChanged: (d) => setState(() => _cleared = d))),
              if (_selected.isNotEmpty) padded(Text('Net of selected: ${inr(selTotal)}', style: const TextStyle(color: Brand.muted))),
            ],
          ]),
        );
      },
    );
  }
}

// Bank statement import + match/book (portal BankStatementPanel).

const _lineLabels = {'unmatched': 'Unmatched', 'matched': 'Matched', 'booked': 'Booked'};
const _lineHex = {'unmatched': Color(0xFFDC2626), 'matched': Color(0xFF16A34A), 'booked': Color(0xFF2563EB)};
const _methodLabels = {'utr': 'UTR', 'cheque': 'Cheque no.', 'amount_date': 'Amount + date', 'manual': 'Manual', 'booked': 'Booked'};

class _StatementPanel extends StatefulWidget {
  const _StatementPanel({required this.recon, required this.onChanged});
  final Json recon;
  final VoidCallback onChanged;

  @override
  State<_StatementPanel> createState() => _StatementPanelState();
}

class _StatementPanelState extends State<_StatementPanel> {
  int _tick = 0;
  bool _busy = false;

  bool get _open => widget.recon['status'] != 'completed';
  bool get _canCreate => finCanFeature('reconciliation', 'bank_statements', 'create');
  bool get _canEdit => finCan('reconciliation', 'edit');
  bool get _canBook => finCanFeature('reconciliation', 'book_statement_lines', 'create');
  bool get _canDelete => finCanFeature('reconciliation', 'bank_statements', 'delete');

  void _changed() {
    setState(() => _tick++);
    widget.onChanged();
  }

  Future<void> _import(Json? meta) async {
    final formats = listOf(meta?['formats']);
    String? format = formats.isEmpty ? null : '${formats.first['value']}';
    PickedProof? file;
    String note = '';
    final ok = await showFormSheet(
      context,
      title: 'Import bank statement',
      saveLabel: 'Import & auto-match',
      builder: (ctx, setS) => [
        const Text("Upload the bank's CSV / XLSX — lines are auto-matched on UTR, cheque number and amount + date.",
            style: TextStyle(color: Brand.muted)),
        AppSelect<String>(
          label: 'Bank format',
          required: true,
          value: format,
          clearable: false,
          options: [for (final f in formats) Option('${f['value']}', '${f['label']}')],
          onChanged: (o) => setS(() => format = o?.value),
        ),
        if (formats.where((f) => f['value'] == format).isNotEmpty && '${formats.firstWhere((f) => f['value'] == format)['notes'] ?? ''}'.isNotEmpty)
          Text('${formats.firstWhere((f) => f['value'] == format)['notes']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
        OutlinedButton.icon(
          icon: const Icon(Icons.upload_file_rounded),
          label: Text(file == null ? 'Statement file (CSV / XLSX)' : '${file!.file.filename}'),
          onPressed: () async {
            final f = await Files.pickFile(extensions: ['csv', 'xlsx', 'xls']);
            if (f != null) setS(() => file = PickedProof(f, 'statement'));
          },
        ),
        Text(
            'Lines dated after ${fmtDate(widget.recon['statement_date'])} are refused; lines already imported from an earlier file are skipped.',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (format == null) throw 'Pick the bank format of the file.';
        if (file == null) throw 'Pick the statement file (CSV / XLSX) to import.';
        final res = asJson(await finUpload('/accounts/bank-statements', file!.file, fields: {
          'bank_reconciliation_id': '${widget.recon['id']}',
          'statement_format': format!,
          'auto_match': 'true',
        }));
        final st = asJson(res['statement']);
        final am = asJson(res['auto_match']);
        final warnings = [for (final w in (res['warnings'] is List ? res['warnings'] as List : const [])) '$w'];
        note = 'Imported ${st['line_count'] ?? 0} line(s)'
            '${toInt(st['skipped_duplicates']) != null && toInt(st['skipped_duplicates'])! > 0 ? ', ${st['skipped_duplicates']} duplicate(s) skipped' : ''}'
            '${am.isNotEmpty ? '. Auto-matched: UTR ${am['utr']}, cheque ${am['cheque']}, amount + date ${am['amount_date']}; ${am['unmatched']} left to match' : ''}.'
            '${warnings.isNotEmpty ? ' ${warnings.join(' ')}' : ''}';
      },
    );
    if (ok && mounted) {
      showSnack(context, note);
      _changed();
    }
  }

  Future<void> _auto() async {
    setState(() => _busy = true);
    try {
      final m = asJson(await Api.post('/accounts/bank-statements/reconciliation/${widget.recon['id']}/auto-match'));
      if (mounted) {
        showSnack(context,
            'Auto-match: UTR ${m['utr']}, cheque ${m['cheque']}, amount + date ${m['amount_date']}; ${m['ambiguous']} ambiguous, ${m['unmatched']} unmatched.');
      }
      _changed();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _matchLine(Json l) async {
    List<Json> cands;
    try {
      cands = asRows(await Api.get('/accounts/bank-statements/lines/${l['id']}/candidates'));
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    final picked = <int>{};
    final exact = cands.where((c) => c['exact_amount'] == true).toList();
    if (exact.length == 1) picked.add(toInt(exact.first['payment_transaction_id'])!);
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'Match ${l['direction'] == 'out' ? 'withdrawal' : 'deposit'} of ${inr(l['amount'])}',
      saveLabel: 'Match',
      builder: (ctx, setS) {
        final total = cands.where((c) => picked.contains(toInt(c['payment_transaction_id']))).fold<double>(0, (s, c) => s + toD(c['amount']));
        return [
          Text(
              'Value date ${fmtDate(l['value_date'])} · ${l['description'] ?? 'No description'}${l['reference'] != null ? ' · Ref ${l['reference']}' : ''}',
              style: const TextStyle(color: Brand.muted)),
          const Caps('Uncleared vouchers — tick the voucher(s) this line clears'),
          if (cands.isEmpty)
            const Text(
                'No uncleared voucher in this direction is dated on or before the value date. Record the voucher under Finance → Payments, or Book this line.'),
          for (final c in cands)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: picked.contains(toInt(c['payment_transaction_id'])),
              onChanged: (v) => setS(() => v == true
                  ? picked.add(toInt(c['payment_transaction_id'])!)
                  : picked.remove(toInt(c['payment_transaction_id']))),
              title: Text('${c['payment_number']} · ${inr(c['amount'])}${c['exact_amount'] == true ? ' (exact)' : ''}'),
              subtitle: Text([fmtDate(c['payment_date']), '${c['party_name'] ?? ''}', '${c['reference_no'] ?? c['cheque_number'] ?? ''}']
                  .where((x) => x.isNotEmpty)
                  .join(' · ')),
            ),
          AmountRow('Selected', inr(total), bold: true, color: (total - toD(l['amount'])).abs() < 0.005 ? null : Brand.danger),
        ];
      },
      onSave: () async {
        final total = cands.where((c) => picked.contains(toInt(c['payment_transaction_id']))).fold<double>(0, (s, c) => s + toD(c['amount']));
        if (picked.isEmpty) throw 'Tick the voucher(s) this statement line clears.';
        if ((total - toD(l['amount'])).abs() >= 0.005) {
          throw 'The ticked vouchers come to ${inr(total)} but the line is ${inr(l['amount'])} — they must be equal.';
        }
        await Api.post('/accounts/bank-statements/lines/${l['id']}/match', data: {'payment_transaction_ids': picked.toList()});
      },
    );
    if (ok) _changed();
  }

  Future<void> _bookLine(Json l, List<Json> kinds) async {
    String? kind = kinds.isEmpty ? null : '${kinds.first['value']}';
    int? gl;
    String? glLabel;
    int? cc;
    String? ccLabel;
    final narration = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Book ${l['direction'] == 'out' ? 'debit' : 'credit'} of ${inr(l['amount'])}',
      saveLabel: 'Post & clear',
      builder: (ctx, setS) {
        final needsLedger = kind == 'other' || (kind == 'interest' && l['direction'] == 'out');
        return [
          InfoBanner(
              'Posts ${l['direction'] == 'out' ? 'an expense payment voucher (Dr ledger / Cr bank)' : 'an other-receipt voucher (Dr bank / Cr ledger)'} dated '
              '${fmtDate(l['value_date'])} and clears it against this line. The bank has already moved the money, so it posts without payment approval.'),
          AppSelect<String>(
            label: 'What is it?',
            required: true,
            value: kind,
            clearable: false,
            options: [for (final k in kinds) Option('${k['value']}', '${k['label']}')],
            onChanged: (o) => setS(() => kind = o?.value),
          ),
          AppSelect<int>(
            label: 'Ledger',
            required: needsLedger,
            value: gl,
            valueLabel: glLabel,
            loadOptions: (q) async => (await FinLookups.ledgerOptions())
                .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                .toList(),
            onChanged: (o) => setS(() {
              gl = o?.value;
              glLabel = o?.label;
            }),
          ),
          if (!needsLedger) const Text('Leave blank to use the Ledger Settings default.', style: TextStyle(fontSize: 12, color: Brand.muted)),
          AppSelect<int>(
            label: 'Cost centre',
            value: cc,
            valueLabel: ccLabel,
            loadOptions: (q) async => (await FinLookups.costCentres())
                .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                .toList(),
            onChanged: (o) => setS(() {
              cc = o?.value;
              ccLabel = o?.label;
            }),
          ),
          const Text('Only if the ledger needs one.', style: TextStyle(fontSize: 12, color: Brand.muted)),
          AppTextField(label: 'Narration', controller: narration, hint: '${l['description'] ?? ''}'),
        ];
      },
      onSave: () async {
        final needsLedger = kind == 'other' || (kind == 'interest' && l['direction'] == 'out');
        if (kind == null) throw 'Pick what this line is.';
        if (needsLedger && gl == null) throw 'Pick the ledger to post this line to.';
        await Api.post('/accounts/bank-statements/lines/${l['id']}/book', data: {
          'kind': kind,
          'gl_account_id': gl,
          'cost_center_id': cc,
          'narration': narration.text.trim().isEmpty ? null : narration.text.trim(),
        });
      },
    );
    if (ok) _changed();
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<(Json, Json?)>(
      key: ValueKey('st$_tick'),
      load: () async {
        final d = asJson(await Api.get('/accounts/bank-statements/reconciliation/${widget.recon['id']}'));
        Json? meta;
        try {
          meta = asJson(await Api.get('/accounts/bank-statements/formats'));
        } catch (_) {}
        return (d, meta);
      },
      builder: (ctx, x, _) {
        final (d, meta) = x;
        final counts = asJson(d['counts']);
        final lines = listOf(d['lines']);
        final kinds = listOf(meta?['book_kinds']);
        return DetailSection('Bank statement', children: [
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final s in const ['unmatched', 'matched', 'booked'])
              StatusBadge('${_lineLabels[s]}: ${counts[s] ?? 0}', color: _lineHex[s]),
          ]),
          const SizedBox(height: 8),
          if (_open)
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (_canCreate) actionBtn('Import statement', _busy ? null : () => _import(meta), primary: true),
              if (_canEdit && (toInt(counts['unmatched']) ?? 0) > 0) actionBtn('Run Auto-match', _busy ? null : _auto),
            ]),
          for (final s in listOf(d['statements']))
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: const Icon(Icons.description_outlined),
              title: Text('${s['file_name'] ?? 'Statement'}'),
              subtitle: Text(
                  '${fmtDate(s['from_date'])} to ${fmtDate(s['to_date'])} · ${s['line_count']} line(s)${s['uploaded_by_name'] != null ? ' · ${s['uploaded_by_name']}' : ''}'),
              trailing: _open && _canDelete
                  ? IconButton(
                      icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                      onPressed: () async {
                        final ok = await confirmDialog(context,
                            title: 'Remove this statement?',
                            message: 'Its lines are deleted. Nothing in the books changes. You can import the file again afterwards.',
                            confirmLabel: 'Remove',
                            danger: true);
                        if (ok && context.mounted) {
                          if (await runAction(context, () => Api.delete('/accounts/bank-statements/${s['id']}'))) _changed();
                        }
                      })
                  : null,
            ),
          for (final l in lines)
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                      child: Text('${fmtDate(l['value_date'])} · ${l['direction'] == 'out' ? 'Debit' : 'Credit'} ${inr(l['amount'])}',
                          style: const TextStyle(fontWeight: FontWeight.w600))),
                  FinStatusPill(l['match_status'], labels: _lineLabels, colors: _lineHex),
                ]),
                if (l['description'] != null) Text('${l['description']}', style: const TextStyle(fontSize: 12.5)),
                if (l['reference'] != null || l['cheque_number'] != null)
                  Text('Ref ${l['reference'] ?? l['cheque_number']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                if (l['match_method'] != null)
                  Text(_methodLabels['${l['match_method']}'] ?? '${l['match_method']}', style: const TextStyle(fontSize: 11, color: Brand.muted)),
                if (listOf(l['matched_numbers']).isNotEmpty || (l['matched_numbers'] is List && (l['matched_numbers'] as List).isNotEmpty))
                  Text('Cleared: ${(l['matched_numbers'] as List).join(', ')}', style: const TextStyle(fontSize: 12)),
                if (_open)
                  Wrap(spacing: 4, children: [
                    if (l['match_status'] == 'unmatched' && _canEdit) TextButton(onPressed: () => _matchLine(l), child: const Text('Match')),
                    if (l['match_status'] == 'unmatched' && _canBook) TextButton(onPressed: () => _bookLine(l, kinds), child: const Text('Book')),
                    if (l['match_status'] != 'unmatched' && _canEdit)
                      TextButton(
                          onPressed: () async {
                            if (await runAction(context, () => Api.post('/accounts/bank-statements/lines/${l['id']}/unmatch'))) _changed();
                          },
                          child: const Text('Unmatch', style: TextStyle(color: Brand.danger))),
                  ]),
              ]),
            ),
        ]);
      },
    );
  }
}

// ── Liquidity forecast ───────────────────────────────────────────────────────

const _repeatLabels = {'none': 'Once', 'weekly': 'Weekly', 'monthly': 'Monthly'};

class _Liquidity extends StatefulWidget {
  const _Liquidity();

  @override
  State<_Liquidity> createState() => _LiquidityState();
}

class _LiquidityState extends State<_Liquidity> {
  int _weeks = 13;
  int _tick = 0;

  Future<void> _item({Json? edit}) async {
    List<Json> cats = [];
    try {
      cats = asRows(await Api.get('/accounts/cash-position/categories'));
    } catch (_) {}
    String direction = '${edit?['direction'] ?? 'outflow'}';
    String category = '${edit?['category'] ?? 'salaries'}';
    final desc = TextEditingController(text: '${edit?['description'] ?? ''}');
    final amount = TextEditingController(text: edit == null ? '' : '${edit['amount']}');
    DateTime date = isoToDate(edit?['expected_date']) ?? DateTime.now();
    String recurrence = '${edit?['recurrence'] ?? 'monthly'}';
    DateTime? end = isoToDate(edit?['end_date']);
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: edit != null ? 'Edit planned cash item' : 'Add planned cash item',
      saveLabel: edit != null ? 'Save' : 'Add',
      builder: (ctx, setS) => [
        const Text('Feeds the liquidity forecast only — nothing is posted.', style: TextStyle(color: Brand.muted)),
        const Caps('Flow'),
        AppSelect<String>(
          label: 'In / Out',
          required: true,
          value: direction,
          clearable: false,
          options: const [Option('inflow', 'In'), Option('outflow', 'Out')],
          onChanged: (o) => setS(() => direction = o?.value ?? direction),
        ),
        AppSelect<String>(
          label: 'Category',
          required: true,
          value: category,
          clearable: false,
          options: [for (final c in cats) Option('${c['value']}', '${c['label']}')],
          onChanged: (o) => setS(() => category = o?.value ?? category),
        ),
        AppTextField(label: 'Description', required: true, controller: desc, hint: 'e.g. October salaries'),
        AppTextField(label: 'Amount (₹)', required: true, controller: amount, keyboardType: AppTextField.number),
        const Caps('When'),
        DateField(label: 'First date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
        AppSelect<String>(
          label: 'Repeat',
          value: recurrence,
          clearable: false,
          options: [for (final e in _repeatLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => recurrence = o?.value ?? recurrence),
        ),
        if (recurrence != 'none') DateField(label: 'Repeat until', value: end, onChanged: (d) => setS(() => end = d)),
      ],
      onSave: () async {
        requireField(desc.text, 'Description');
        final a = double.tryParse(amount.text);
        if (a == null || a <= 0) throw 'Enter the amount — a number greater than zero.';
        final payload = {
          'direction': direction,
          'category': category,
          'description': desc.text.trim(),
          'amount': a,
          'expected_date': apiDate(date),
          'recurrence': recurrence,
          'end_date': recurrence == 'none' ? null : dateOrNull(end),
        };
        if (edit != null) {
          await Api.patch('/accounts/cash-position/items/${edit['id']}', data: payload);
        } else {
          await Api.post('/accounts/cash-position/items', data: payload);
        }
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = finCan('liquidity', 'create');
    final canEdit = finCan('liquidity', 'edit');
    final canDelete = finCan('liquidity', 'delete');
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      const InfoBanner(
          'Cash today plus what the books say will come in (customer invoices by due date) and go out (vendor bills, approved payment runs), '
          'and the planned items below, week by week. A negative projected balance is a funding gap to plan for.'),
      padded(AppSelect<int>(
        label: 'Horizon',
        value: _weeks,
        clearable: false,
        options: const [Option(4, '4 weeks'), Option(8, '8 weeks'), Option(13, '13 weeks'), Option(26, '26 weeks')],
        onChanged: (o) => setState(() {
          _weeks = o?.value ?? 13;
          _tick++;
        }),
      )),
      ApiLoader<Json>(
        key: ValueKey('cp$_tick'),
        load: () async => asJson(await Api.get('/accounts/cash-position', query: {'weeks': _weeks})),
        builder: (ctx, cp, _) {
          final cols = listOf(cp['columns']);
          final weeks = listOf(cp['weeks']);
          final rows = listOf(cp['rows']);
          String label(String key) {
            if (key == 'overdue') return 'Overdue';
            for (final w in weeks) {
              if (w['key'] == key) return '${w['label']}';
            }
            return key;
          }

          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            StatGrid([
              StatCard('Bank & Cash Today', inr(cp['opening_balance'])),
              StatCard('Projected after ${cp['horizon_weeks']} weeks', inr(cols.isEmpty ? null : cols.last['closing_balance'])),
              StatCard('Lowest Projected Balance', inr(cp['lowest_balance']), tone: toD(cp['lowest_balance']) < 0 ? _red : null),
            ]),
            const SectionTitle('Week by week'),
            for (final c in cols)
              RecordCard(
                title: label('${c['key']}'),
                meta: [
                  ('Inflows', inr(c['inflows'])),
                  ('Outflows', inr(c['outflows'])),
                  ('Net', inr(c['net'])),
                  ('Closing', inr(c['closing_balance'])),
                ],
                trailing: toD(c['closing_balance']) < 0 ? const StatusBadge('Gap', color: _red) : null,
                onTap: () {
                  final items = listOf(cp['items']).where((i) => i['bucket'] == c['key']).toList();
                  openScreen(
                      ctx,
                      SubPage(
                        title: label('${c['key']}'),
                        body: items.isEmpty
                            ? const EmptyView('Nothing in this cell.')
                            : ListView(padding: const EdgeInsets.only(top: 12), children: [
                                for (final i in items)
                                  RecordCard(
                                    title: '${i['reference'] ?? i['category']}',
                                    subtitle: '${i['party'] ?? ''}',
                                    status: i['direction'] == 'in' ? 'Inflow' : 'Outflow',
                                    meta: [('Expected', fmtDate(i['date'])), ('Amount', inr(i['amount'])), if (i['note'] != null) ('Note', '${i['note']}')],
                                  ),
                              ]),
                      ));
                },
              ),
            const SectionTitle('Cash flow by category'),
            for (final r in rows)
              RecordCard(
                title: '${r['label']}',
                status: r['direction'] == 'in' ? 'Inflow' : 'Outflow',
                meta: [
                  if (toD(r['overdue']) != 0) ('Overdue', inr(r['overdue'])),
                  ('Later', inr(r['later'])),
                  ('Not scheduled', inr(r['unscheduled'])),
                  ('Total', inr(r['total'])),
                ],
              ),
          ]);
        },
      ),
      SectionTitle('Planned items',
          action: canCreate ? TextButton(onPressed: () => _item(), child: const Text('+ Add planned item')) : null),
      padded(const Text(
          "Flows the books can't predict: salaries, GST / TDS / PF deposits, loan EMIs, capex, planned loans. They only feed the forecast.",
          style: TextStyle(fontSize: 12, color: Brand.muted))),
      ApiLoader<List<Json>>(
        key: ValueKey('pi$_tick'),
        load: () async => asRows(await Api.get('/accounts/cash-position/items')),
        builder: (ctx, items, _) => Column(children: [
          if (items.isEmpty) const EmptyView('No planned items yet.'),
          for (final i in items)
            RecordCard(
              title: '${i['description']}',
              subtitle: '${i['category_label'] ?? i['category']}',
              status: i['direction'] == 'inflow' ? 'In' : 'Out',
              meta: [
                ('From', fmtDate(i['expected_date'])),
                ('Repeat', '${_repeatLabels['${i['recurrence']}'] ?? i['recurrence']}${i['end_date'] != null ? ' until ${fmtDate(i['end_date'])}' : ''}'),
                ('Amount', inr(i['amount'])),
              ],
              trailing: canEdit || canDelete
                  ? PopupMenuButton<String>(
                      onSelected: (v) async {
                        if (v == 'edit') return _item(edit: i);
                        final ok = await confirmDialog(context,
                            title: 'Delete this planned item?',
                            message: "It drops out of the cash forecast. Nothing was ever posted, so the books don't change.",
                            confirmLabel: 'Delete',
                            danger: true);
                        if (ok && context.mounted) {
                          if (await runAction(context, () => Api.delete('/accounts/cash-position/items/${i['id']}'))) setState(() => _tick++);
                        }
                      },
                      itemBuilder: (_) => [
                        if (canEdit) const PopupMenuItem(value: 'edit', child: Text('Edit')),
                        if (canDelete) const PopupMenuItem(value: 'delete', child: Text('Delete')),
                      ],
                    )
                  : null,
            ),
        ]),
      ),
    ]);
  }
}

const _red = Color(0xFFDC2626);

// ── Guarantees & EMD ─────────────────────────────────────────────────────────

const _bgStatusLabels = {
  'draft': 'Draft', 'submitted': 'Awaiting approval', 'approved': 'Approved — apply to bank', 'active': 'Active', 'released': 'Released',
  'invoked': 'Invoked', 'cancelled': 'Cancelled',
};
const _bgStatusHex = {
  'draft': Color(0xFF64748B), 'submitted': Color(0xFFF59E0B), 'approved': Color(0xFF8B5CF6), 'active': Color(0xFF16A34A),
  'released': Color(0xFF2563EB), 'invoked': Color(0xFFDC2626), 'cancelled': Color(0xFF94A3B8),
};
const _marginLabels = {'none': '—', 'placed': 'Placed', 'released': 'Released', 'consumed': 'Consumed'};
const _formLabels = {'bank_guarantee': 'Bank guarantee', 'lc': 'Letter of credit', 'deposit': 'Cash deposit (DD / NEFT / FDR)'};
const _eventLabels = {
  'created': 'Recorded', 'submitted': 'Sent for approval', 'approved': 'Approved', 'rejected': 'Rejected', 'issued': 'Issued by bank',
  'extended': 'Extended', 'margin_placed': 'Margin placed', 'margin_released': 'Margin released', 'commission': 'Commission',
  'released': 'Released', 'invoked': 'Invoked', 'cancelled': 'Cancelled', 'document': 'Document',
};

class _Guarantees extends StatefulWidget {
  const _Guarantees();

  @override
  State<_Guarantees> createState() => _GuaranteesState();
}

class _GuaranteesState extends State<_Guarantees> {
  final _list = GlobalKey<ApiListViewState>();
  bool _openOnly = true;
  String? _direction;
  String? _card;
  List<Json> _all = [];

  Future<void> _new() async {
    List<Json> types = [];
    List<Json> banks = [];
    try {
      types = listOf(asJson(await Api.get('/accounts/bank-guarantees/meta'))['instrument_types']);
      banks = (await _accounts()).where((b) => b['account_kind'] == 'bank').toList();
    } catch (_) {}
    final f = <String, dynamic>{
      'direction': 'issued', 'instrument_type': 'pbg', 'instrument_form': 'bank_guarantee', 'margin_percent': '10',
    };
    final amount = TextEditingController();
    final margin = TextEditingController(text: '10');
    final counterparty = TextEditingController();
    final issuingBank = TextEditingController();
    final instrumentNo = TextEditingController();
    final purpose = TextEditingController();
    List<Option<int>> tenders = [];
    Json? saved;
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'New bank guarantee / LC / EMD',
      saveLabel: f['direction'] == 'issued' ? 'Save draft' : 'Record',
      builder: (ctx, setS) {
        final issued = f['direction'] == 'issued';
        return [
          Text(
              issued
                  ? 'Issued by us — saved as a draft, then sent for Finance + Partner approval before you apply to the bank.'
                  : 'Received by us from a supplier — recorded straight into the register.',
              style: const TextStyle(color: Brand.muted)),
          const Caps('Instrument'),
          AppSelect<String>(
            label: 'Direction',
            required: true,
            value: f['direction'] as String,
            clearable: false,
            options: const [Option('issued', 'Issued by us'), Option('received', 'Received by us')],
            onChanged: (o) => setS(() => f['direction'] = o?.value ?? 'issued'),
          ),
          AppSelect<String>(
            label: 'Instrument',
            required: true,
            value: f['instrument_type'] as String?,
            clearable: false,
            options: [
              for (final t in types)
                if (t['direction'] == null || t['direction'] == f['direction']) Option('${t['value']}', '${t['label']}'),
            ],
            onChanged: (o) => setS(() => f['instrument_type'] = o?.value),
          ),
          if (issued && f['instrument_type'] != 'lc')
            AppSelect<String>(
              label: 'Given as',
              value: f['instrument_form'] as String,
              clearable: false,
              options: [Option('bank_guarantee', _formLabels['bank_guarantee']!), Option('deposit', _formLabels['deposit']!)],
              onChanged: (o) => setS(() => f['instrument_form'] = o?.value ?? 'bank_guarantee'),
            ),
          AppTextField(label: 'Amount (₹)', required: true, controller: amount, keyboardType: AppTextField.number),
          if (issued && f['instrument_form'] != 'deposit') AppTextField(label: 'Margin %', controller: margin, keyboardType: AppTextField.number),
          Caps(issued ? 'Beneficiary & bank' : 'Applicant & bank'),
          if (issued)
            AppSelect<int>(
              label: 'Customer (beneficiary)',
              value: f['customer_id'] as int?,
              valueLabel: f['customer_label'] as String?,
              loadOptions: customerOptions,
              onChanged: (o) async {
                setS(() {
                  f['customer_id'] = o?.value;
                  f['customer_label'] = o?.label;
                  f['tender_id'] = null;
                  tenders = [];
                });
                if (o != null) {
                  try {
                    final rows = asRows(await Api.get('/crm/tenders', query: {'org_id': o.value}));
                    setS(() => tenders = [
                          for (final t in rows)
                            Option(toInt(t['id'])!,
                                [t['tender_number'], t['tender_name']].where((x) => x != null).join(' — ').isEmpty
                                    ? '${t['universal_id']}'
                                    : [t['tender_number'], t['tender_name']].where((x) => x != null).join(' — ')),
                        ]);
                  } catch (_) {}
                }
              },
            )
          else
            AppSelect<int>(
              label: 'Supplier (applicant)',
              value: f['vendor_id'] as int?,
              valueLabel: f['vendor_label'] as String?,
              loadOptions: FinLookups.vendors,
              onChanged: (o) => setS(() {
                f['vendor_id'] = o?.value;
                f['vendor_label'] = o?.label;
              }),
            ),
          AppTextField(
              label: issued ? 'Beneficiary as on instrument' : 'Applicant as on instrument',
              controller: counterparty,
              hint: issued ? 'e.g. PCMM, Central Railway' : null),
          AppSelect<int>(
            label: issued ? 'Our bank account' : 'Our bank account (claims credited to)',
            value: f['bank_account_id'] as int?,
            options: [for (final b in banks) Option(toInt(b['id'])!, _acctLabel(b))],
            onChanged: (o) => setS(() => f['bank_account_id'] = o?.value),
          ),
          if (!issued) AppTextField(label: 'Issuing bank (as printed)', controller: issuingBank),
          if (issued) ...[
            const Caps('Linked to'),
            AppSelect<int>(
              label: 'Tender',
              value: f['tender_id'] as int?,
              options: tenders,
              onChanged: (o) => setS(() => f['tender_id'] = o?.value),
            ),
          ],
          const Caps('Dates'),
          if (!issued) ...[
            AppTextField(label: 'Instrument no.', controller: instrumentNo),
            DateField(label: 'Issue date', value: f['issue_date'] as DateTime?, onChanged: (d) => setS(() => f['issue_date'] = d)),
          ],
          DateField(label: 'Expiry date', value: f['expiry_date'] as DateTime?, onChanged: (d) => setS(() => f['expiry_date'] = d)),
          DateField(label: 'Claim period ends', value: f['claim_expiry_date'] as DateTime?, onChanged: (d) => setS(() => f['claim_expiry_date'] = d)),
          AppTextField(label: 'Purpose', controller: purpose, hint: 'e.g. PBG 5% of LOA value, 60 days beyond warranty'),
        ];
      },
      onSave: () async {
        final a = double.tryParse(amount.text) ?? 0;
        if (a <= 0) throw 'Enter the guarantee amount.';
        final issued = f['direction'] == 'issued';
        String? s(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
        saved = asJson(await Api.post('/accounts/bank-guarantees', data: {
          'direction': f['direction'],
          'instrument_type': f['instrument_type'],
          'instrument_form': f['instrument_type'] == 'lc' ? 'lc' : f['instrument_form'],
          'amount': a,
          'margin_percent': issued && f['instrument_form'] != 'deposit' && margin.text.trim().isNotEmpty ? double.tryParse(margin.text) : null,
          'bank_account_id': f['bank_account_id'],
          'customer_id': issued ? f['customer_id'] : null,
          'vendor_id': issued ? null : f['vendor_id'],
          'tender_id': f['tender_id'],
          'counterparty_name': s(counterparty),
          'issuing_bank_name': s(issuingBank),
          'instrument_number': s(instrumentNo),
          'issue_date': dateOrNull(f['issue_date'] as DateTime?),
          'expiry_date': dateOrNull(f['expiry_date'] as DateTime?),
          'claim_expiry_date': dateOrNull(f['claim_expiry_date'] as DateTime?),
          'purpose': s(purpose),
        }));
      },
    );
    if (ok) {
      _list.currentState?.reload();
      if (saved != null && mounted) openScreen(context, _BgScreen(id: toInt(saved!['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    double issuedTotal = 0, margin = 0;
    int expiring = 0;
    for (final r in _all) {
      if (r['direction'] == 'issued' && r['status'] == 'active') issuedTotal += toD(r['amount']);
      if (r['margin_status'] == 'placed') margin += toD(r['margin_amount']);
      final d = toInt(r['days_to_expiry']);
      if (d != null && d >= 0 && d <= 30 && r['status'] == 'active') expiring++;
    }
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCan('guarantees', 'create') ? CreateFab(label: 'New Instrument', onPressed: _new) : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async {
          final rows = asRows(await Api.get('/accounts/bank-guarantees', query: {'open_only': _openOnly, 'direction': _direction}));
          if (mounted) setState(() => _all = rows);
          return ApiPage(rows.where((r) {
            switch (_card) {
              case 'issued_active':
                return r['direction'] == 'issued' && r['status'] == 'active';
              case 'margin':
                return r['margin_status'] == 'placed';
              case 'expiring':
                final d = toInt(r['days_to_expiry']);
                return d != null && d >= 0 && d <= 30 && r['status'] == 'active';
            }
            return true;
          }).toList());
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const InfoBanner(
              'Register of bank guarantees, LCs, EMD and security deposits — issued to customers (PBG / ABG / EMD for Railway tenders and '
              'orders) and received from suppliers. An issued instrument is approved by a Finance approver and then a Partner before you apply to the bank; '
              'margin money, commission, release and invocation are posted as vouchers. Reminders (bell + Teams) go out 30, 15, 7 and 1 day before expiry and '
              'claim-period end.'),
          StatGrid([
            StatCard('Issued & Active', inr(issuedTotal),
                active: _card == 'issued_active', onTap: () => setState(() => _card = _card == 'issued_active' ? null : 'issued_active')),
            StatCard('Margin / Deposits Blocked', inr(margin),
                active: _card == 'margin', onTap: () => setState(() => _card = _card == 'margin' ? null : 'margin')),
            StatCard('Expiring ≤ 30 Days', '$expiring',
                tone: expiring > 0 ? const Color(0xFFD97706) : null,
                active: _card == 'expiring',
                onTap: () => setState(() => _card = _card == 'expiring' ? null : 'expiring')),
          ]),
          padded(Row(children: [
            Expanded(
              child: AppSelect<String>(
                label: 'Direction',
                value: _direction,
                options: const [Option('issued', 'Issued by us'), Option('received', 'Received by us')],
                onChanged: (o) => setState(() {
                  _direction = o?.value;
                  _list.currentState?.reload();
                }),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
                child: CheckField(
                    label: 'Open only',
                    value: _openOnly,
                    onChanged: (v) => setState(() {
                          _openOnly = v;
                          _list.currentState?.reload();
                        }))),
          ])),
        ]),
        emptyText: 'No instruments in this view.',
        itemBuilder: (ctx, r, reload) {
          final d = toInt(r['days_to_expiry']);
          return RecordCard(
            code: '${r['bg_number']} · ${r['direction'] == 'issued' ? 'Issued' : 'Received'}',
            title: '${r['customer_name'] ?? r['vendor_name'] ?? r['counterparty_name'] ?? '—'}',
            subtitle: '${r['instrument_type_label']}',
            trailing: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                FinStatusPill(r['status'], labels: _bgStatusLabels, colors: _bgStatusHex),
                if (r['status'] == 'submitted') ApprovalBadge(status: r['approval_status'] as String?, stage: r['approval_stage'] as String?),
              ]),
            ),
            meta: [
              ('Amount', inr(r['amount'])),
              ('Expiry', '${fmtDate(r['expiry_date'])}${d != null ? (d < 0 ? ' (${-d} d ago)' : ' ($d d left)') : ''}'),
              ('Claim until', fmtDate(r['claim_expiry_date'])),
              ('Bank', '${r['bank_account_label'] ?? r['issuing_bank_name'] ?? '—'}${r['instrument_number'] != null ? ' · ${r['instrument_number']}' : ''}'),
              if (toD(r['margin_amount']) != 0) ('Margin', '${inr(r['margin_amount'])} · ${_marginLabels['${r['margin_status']}'] ?? ''}'),
              if ([r['sales_order_number'], r['tender_label'], r['purchase_order_number']].any((x) => x != null))
                ('Linked to', [r['sales_order_number'], r['tender_label'], r['purchase_order_number']].where((x) => x != null).join(' · ')),
            ],
            onTap: () async {
              await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => _BgScreen(id: toInt(r['id'])!)));
              reload();
            },
          );
        },
      ),
    );
  }
}

class _BgScreen extends StatefulWidget {
  const _BgScreen({required this.id});
  final int id;

  @override
  State<_BgScreen> createState() => _BgScreenState();
}

const _actionTitles = {
  'issue': 'Mark as issued by the bank', 'margin': 'Post margin money / deposit', 'commission': 'Book bank commission',
  'extend': 'Extend the instrument', 'release': 'Release / close', 'invoke': 'Record invocation (claim)', 'cancel': 'Cancel the instrument',
};

class _BgScreenState extends State<_BgScreen> {
  int _tick = 0;

  Future<void> _action(Json bg, String action) async {
    final f = <String, dynamic>{
      'issue_date': DateTime.now(),
      'expiry_date': isoToDate(bg['expiry_date']),
      'claim_expiry_date': isoToDate(bg['claim_expiry_date']),
      'posting_date': DateTime.now(),
      'payment_mode': 'neft',
      'amendment_date': DateTime.now(),
      'release_date': DateTime.now(),
      'invoke_date': DateTime.now(),
    };
    final instrumentNo = TextEditingController(text: '${bg['instrument_number'] ?? ''}');
    final amount = TextEditingController(text: action == 'invoke' ? '${bg['amount']}' : '');
    final reference = TextEditingController();
    final reason = TextEditingController();
    int? gl;
    String? glLabel;
    final money = const ['margin', 'commission', 'release', 'invoke'].contains(action);
    final needsReason = const ['extend', 'release', 'invoke', 'cancel'].contains(action);
    final posting = {
      'margin':
          'Posts a payment voucher: Dr ${bg['instrument_form'] == 'deposit' ? 'EMD & Security Deposits' : 'Margin Money with Banks'} / Cr ${bg['bank_account_label'] ?? 'bank'} for ${inr(bg['margin_amount'])}.',
      'commission': 'Posts a payment voucher: Dr Bank Guarantee & LC Commission / Cr bank.',
      'release': bg['direction'] == 'issued' && bg['margin_status'] == 'placed'
          ? 'The margin of ${inr(bg['margin_amount'])} comes back by a receipt voucher (Dr bank / Cr margin).'
          : 'No money moves — the instrument is just closed.',
      'invoke': bg['direction'] == 'issued'
          ? 'Dr Bank guarantees invoked (or the ledger you pick); the margin is used first (journal), the rest is paid from the bank; any unused margin is refunded.'
          : 'Posts a receipt voucher: Dr bank / Cr LD / penalties recovered from vendors (or the ledger you pick).',
    };
    final ok = await showFormSheet(
      context,
      title: _actionTitles[action] ?? action,
      saveLabel: 'Confirm',
      builder: (ctx, setS) {
        DateField date(String k, String label, {bool required = false}) =>
            DateField(label: label, required: required, value: f[k] as DateTime?, onChanged: (d) => setS(() => f[k] = d));
        return [
          Text('${bg['bg_number']} — ${bg['instrument_type_label']}', style: const TextStyle(color: Brand.muted)),
          if (posting[action] != null) InfoBanner(posting[action]!),
          if (action == 'issue') ...[
            AppTextField(label: "Bank's instrument no.", required: true, controller: instrumentNo),
            date('issue_date', 'Issue date'),
            date('expiry_date', 'Expiry date'),
            date('claim_expiry_date', 'Claim period ends'),
          ],
          if (action == 'margin' || action == 'commission') date('posting_date', 'Posting date'),
          if (action == 'commission') AppTextField(label: 'Commission (₹)', controller: amount, keyboardType: AppTextField.number),
          if (action == 'extend') ...[
            date('new_expiry_date', 'New expiry', required: true),
            date('new_claim_expiry_date', 'New claim end'),
            const Text('Blank = keep the period.', style: TextStyle(fontSize: 12, color: Brand.muted)),
            date('amendment_date', 'Amendment date'),
          ],
          if (action == 'release') date('release_date', 'Release date'),
          if (action == 'invoke') ...[
            date('invoke_date', 'Invoked on'),
            AppTextField(label: 'Amount claimed (₹)', controller: amount, keyboardType: AppTextField.number),
            AppSelect<int>(
              label: 'Ledger',
              value: gl,
              valueLabel: glLabel ?? (gl == null ? 'Default ledger' : null),
              loadOptions: (q) async => (await FinLookups.ledgerOptions(filter: (a) => a['is_control_account'] != true))
                  .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                  .toList(),
              onChanged: (o) => setS(() {
                gl = o?.value;
                glLabel = o?.label;
              }),
            ),
          ],
          if (money) ...[
            AppSelect<String>(
              label: 'Mode',
              value: f['payment_mode'] as String,
              clearable: false,
              options: [for (final m in const ['neft', 'rtgs', 'imps', 'dd']) Option(m, m.toUpperCase())],
              onChanged: (o) => setS(() => f['payment_mode'] = o?.value ?? 'neft'),
            ),
            AppTextField(label: 'Bank ref / UTR', controller: reference),
          ],
          if (needsReason) AppTextField(label: 'Reason / letter reference', required: true, controller: reason, maxLines: 2),
        ];
      },
      onSave: () async {
        if (needsReason && reason.text.trim().isEmpty) throw 'Give the reason — it is kept on the instrument history.';
        if (action == 'extend' && f['new_expiry_date'] == null) throw "Enter the new expiry date from the bank's amendment.";
        if (action == 'issue' && instrumentNo.text.trim().isEmpty) throw "Enter the bank's instrument number.";
        String? s(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
        String? d(String k) => dateOrNull(f[k] as DateTime?);
        final payload = switch (action) {
          'issue' => {'instrument_number': instrumentNo.text.trim(), 'issue_date': d('issue_date'), 'expiry_date': d('expiry_date'), 'claim_expiry_date': d('claim_expiry_date')},
          'margin' => {'posting_date': d('posting_date'), 'payment_mode': f['payment_mode'], 'reference_no': s(reference)},
          'commission' => {'posting_date': d('posting_date'), 'amount': double.tryParse(amount.text) ?? 0, 'payment_mode': f['payment_mode'], 'reference_no': s(reference)},
          'extend' => {'new_expiry_date': d('new_expiry_date'), 'new_claim_expiry_date': d('new_claim_expiry_date'), 'amendment_date': d('amendment_date'), 'reason': reason.text.trim()},
          'release' => {'release_date': d('release_date'), 'reason': reason.text.trim(), 'payment_mode': f['payment_mode'], 'reference_no': s(reference)},
          'invoke' => {
              'invoke_date': d('invoke_date'), 'amount': double.tryParse(amount.text) ?? 0, 'reason': reason.text.trim(), 'gl_account_id': gl,
              'payment_mode': f['payment_mode'], 'reference_no': s(reference),
            },
          _ => {'reason': reason.text.trim()},
        };
        await Api.post('/accounts/bank-guarantees/${bg['id']}/$action', data: payload);
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      key: ValueKey(_tick),
      load: () async => asJson(await Api.get('/accounts/bank-guarantees/${widget.id}')),
      builder: (ctx, bg, reload) {
        final s = bg['status'];
        final issued = bg['direction'] == 'issued';
        final lifecycle = finCanFeature('guarantees', 'lifecycle', 'edit');
        final postings = finCanFeature('guarantees', 'bank_postings', 'create');
        final buttons = <(String, String, bool)>[
          ('submit', 'Send for Approval', issued && s == 'draft' && finCan('guarantees', 'submit')),
          ('issue', 'Mark Issued by Bank', issued && s == 'approved' && lifecycle),
          (
            'margin',
            bg['instrument_form'] == 'deposit' ? 'Post Deposit Payment' : 'Post Margin Money',
            issued && (s == 'approved' || s == 'active') && bg['margin_status'] == 'none' && toD(bg['margin_amount']) > 0 && postings
          ),
          ('commission', 'Book Commission', issued && bg['instrument_form'] != 'deposit' && (s == 'approved' || s == 'active') && postings),
          ('extend', 'Extend', s == 'active' && lifecycle),
          ('release', 'Release / Close', s == 'active' && lifecycle),
          ('invoke', 'Record Invocation', s == 'active' && finCanFeature('guarantees', 'invocation', 'approve')),
          ('cancel', 'Cancel', const ['draft', 'submitted', 'approved'].contains(s) && bg['margin_status'] == 'none' && finCan('guarantees', 'cancel')),
        ];
        final actions = [
          for (final (a, label, show) in buttons)
            if (show)
              actionBtn(
                label,
                () async {
                  if (a == 'submit') {
                    if (await runAction(context, () => Api.post('/accounts/bank-guarantees/${bg['id']}/submit', data: {}),
                        success: 'Sent for approval.')) {
                      setState(() => _tick++);
                    }
                  } else {
                    _action(bg, a);
                  }
                },
                primary: a == 'submit' || a == 'issue',
                danger: a == 'invoke' || a == 'cancel',
              ),
        ];
        final linked = [bg['sales_order_number'], bg['tender_label'], bg['purchase_order_number']].where((x) => x != null).join(' · ');
        return SubPage(
          title: '${bg['bg_number']} — ${bg['instrument_type_label']}',
          bottom: actions.isEmpty ? null : ActionBar(actions),
          body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            padded(Wrap(spacing: 8, runSpacing: 6, children: [
              FinStatusPill(s, labels: _bgStatusLabels, colors: _bgStatusHex),
              Text('${issued ? 'Issued by us' : 'Received by us'} · ${inr(bg['amount'])}', style: const TextStyle(color: Brand.muted)),
            ])),
            if (s == 'submitted' || bg['approval_request_id'] != null)
              ApprovalPanel(entityType: 'accounts_bank_guarantee', entityId: toInt(bg['id'])!, onChanged: reload),
            DetailSection('Party & bank', children: [
              FieldRow(issued ? 'Beneficiary' : 'Applicant', bg['customer_name'] ?? bg['vendor_name'] ?? bg['counterparty_name']),
              if ((bg['customer_name'] != null || bg['vendor_name'] != null) && bg['counterparty_name'] != null)
                FieldRow('Name on the instrument', bg['counterparty_name']),
              FieldRow('Bank', bg['bank_account_label'] ?? bg['issuing_bank_name']),
              FieldRow('Instrument no.', bg['instrument_number']),
              FieldRow('Linked to', linked.isEmpty ? null : linked),
              if (bg['purpose'] != null) FieldRow('Purpose', bg['purpose']),
            ]),
            DetailSection('Amount & dates', children: [
              FieldRow('Amount', inr(bg['amount'])),
              FieldRow(
                  bg['instrument_form'] == 'deposit' ? 'Deposit' : 'Margin money',
                  toD(bg['margin_amount']) == 0
                      ? null
                      : '${inr(bg['margin_amount'])}${bg['margin_percent'] != null && bg['instrument_form'] != 'deposit' ? ' (${bg['margin_percent']}%)' : ''} · ${_marginLabels['${bg['margin_status']}'] ?? ''}'),
              if (toD(bg['commission_total']) > 0) FieldRow('Commission paid', inr(bg['commission_total'])),
              FieldRow('Issued on', bg['issue_date'] == null ? null : fmtDate(bg['issue_date'])),
              FieldRow('Expires on',
                  bg['expiry_date'] == null ? null : '${fmtDate(bg['expiry_date'])}${bg['claim_expiry_date'] != null ? ' · claims until ${fmtDate(bg['claim_expiry_date'])}' : ''}'),
              if (bg['closure_reason'] != null)
                FieldRow(s == 'invoked' ? 'Invoked (${inr(bg['invoked_amount'])})' : 'Closed because',
                    '${bg['closure_reason']}${bg['closed_on'] != null ? ' · ${fmtDate(bg['closed_on'])}' : ''}'),
            ]),
            if (finCanFeature('guarantees', 'instrument_copy', 'view'))
              DetailSection('Instrument copy', children: [
                if (bg['has_document'] == true || bg['document_name'] != null)
                  TextButton.icon(
                      onPressed: () => finDownload(context, '/accounts/bank-guarantees/${bg['id']}/document', '${bg['document_name'] ?? '${bg['bg_number']}.pdf'}'),
                      icon: const Icon(Icons.open_in_new_rounded),
                      label: Text('${bg['document_name'] ?? 'Open instrument copy'}'))
                else
                  const Text('No copy uploaded yet.', style: TextStyle(color: Brand.muted)),
                if (finCanFeature('guarantees', 'instrument_copy', 'create') && s != 'cancelled')
                  OutlinedButton.icon(
                    icon: const Icon(Icons.upload_file_rounded),
                    label: const Text('Upload copy (PDF / photo)'),
                    onPressed: () async {
                      final f = await Files.pickFile(extensions: ['pdf', 'jpg', 'jpeg', 'png']);
                      if (f == null || !context.mounted) return;
                      if (await runAction(context, () => finUpload('/accounts/bank-guarantees/${bg['id']}/document', f), success: 'Instrument copy uploaded.')) {
                        setState(() => _tick++);
                      }
                    },
                  ),
              ]),
            DetailSection('History', children: [
              if (listOf(bg['events']).isEmpty) const Text('Nothing has happened on this instrument yet.', style: TextStyle(color: Brand.muted)),
              for (final e in listOf(bg['events']))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${fmtDate(e['event_date'])} · ${_eventLabels['${e['event_type']}'] ?? e['event_type']}${e['amount'] != null ? ' · ${inr(e['amount'])}' : ''}',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(
                        [
                          if (e['voucher_number'] != null) 'Voucher ${e['voucher_number']}',
                          if (e['event_type'] == 'extended') '${fmtDate(e['old_expiry_date'])} → ${fmtDate(e['new_expiry_date'])}',
                          if (e['notes'] != null) '${e['notes']}',
                          if (e['created_by_name'] != null) '${e['created_by_name']}',
                        ].join(' · '),
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ]),
                ),
            ]),
          ]),
        );
      },
    );
  }
}
