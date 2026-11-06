import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';
import 'fin_journals.dart';

/// Finance › Reports (portal finance/reports/page.tsx + ControllingReports).
class FinReportsPage extends StatefulWidget {
  const FinReportsPage({super.key});

  @override
  State<FinReportsPage> createState() => _FinReportsPageState();
}

const _green = Color(0xFF16A34A);
const _red = Color(0xFFDC2626);

/// Shared date range of the range reports (portal: one From/To for all tabs).
class _Range {
  DateTime from = fyStart();
  DateTime to = DateTime.now();
}

class _FinReportsPageState extends State<FinReportsPage> {
  final _r = _Range();

  Widget _ranged(String tab, Widget Function() child, {bool asAt = false, String? note}) => _RangeBox(
        range: _r,
        asAt: asAt,
        asAtLabel: tab == 'Balance Sheet' ? 'As at' : 'To',
        note: note,
        child: child,
      );

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Financial Reports',
        subtitle:
            'Trial Balance, Schedule III statements, cash flow, aging, budgets and the year-end close — computed live from posted vouchers.',
        tabs: [
          FinSubTab('Trial Balance', (_) => _ranged('Trial Balance', () => _TrialBalance(r: _r)), permTab: 'financial_reports'),
          FinSubTab('Profit & Loss', (_) => _ranged('Profit & Loss', () => _ProfitLoss(r: _r)), permTab: 'financial_reports'),
          FinSubTab('Balance Sheet',
              (_) => _ranged('Balance Sheet', () => _BalanceSheet(r: _r),
                  asAt: true, note: 'A balance sheet is a position on one date — only the "to" date applies.'),
              permTab: 'financial_reports'),
          FinSubTab('Cash Flow', (_) => _ranged('Cash Flow', () => _CashFlow(r: _r)), permTab: 'financial_reports'),
          FinSubTab('Aging', (_) => const _Aging(), permTab: 'financial_reports'),
          FinSubTab('Budget Variance', (_) => _ranged('Budget Variance', () => _Variance(r: _r)), permTab: 'financial_reports'),
          FinSubTab('Cost Centres', (_) => _ranged('Cost Centres', () => _CostCentres(r: _r)), permTab: 'financial_reports'),
          FinSubTab('Internal Orders',
              (_) => _ranged('Internal Orders', () => _InternalOrders(r: _r),
                  asAt: true, note: 'Internal orders are shown life to date — only the "to" date applies.'),
              permTab: 'financial_reports'),
          FinSubTab('Monthly Pack', (_) => const _MonthlyPack(), permTab: 'financial_reports'),
          FinSubTab('Year-end Close', (_) => const _YearEnd(), permTab: 'year_end_close'),
        ],
      );
}

class _RangeBox extends StatefulWidget {
  const _RangeBox({required this.range, required this.child, this.asAt = false, this.asAtLabel = 'To', this.note});
  final _Range range;
  final Widget Function() child;
  final bool asAt;
  final String asAtLabel;
  final String? note;

  @override
  State<_RangeBox> createState() => _RangeBoxState();
}

class _RangeBoxState extends State<_RangeBox> {
  int _tick = 0;

  (DateTime, DateTime) _quick(String k) {
    final now = DateTime.now();
    final fy = fyStart();
    switch (k) {
      case 'this_month':
        return (DateTime(now.year, now.month, 1), now);
      case 'last_month':
        return (DateTime(now.year, now.month - 1, 1), DateTime(now.year, now.month, 0));
      case 'this_fy':
        return (fy, now);
      default:
        return (DateTime(fy.year - 1, 4, 1), DateTime(fy.year, 3, 31));
    }
  }

  bool _same(DateTime a, DateTime b) => apiDate(a) == apiDate(b);

  @override
  Widget build(BuildContext context) {
    final r = widget.range;
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
        child: Row(children: [
          if (!widget.asAt) ...[
            Expanded(
                child: DateField(
                    label: 'From', required: true, value: r.from, onChanged: (d) => setState(() {
                          if (d != null) r.from = d;
                          _tick++;
                        }))),
            const SizedBox(width: 8),
          ],
          Expanded(
              child: DateField(
                  label: widget.asAtLabel, required: true, value: r.to, onChanged: (d) => setState(() {
                        if (d != null) r.to = d;
                        _tick++;
                      }))),
        ]),
      ),
      ChipRow([
        for (final (k, l) in const [('this_month', 'This month'), ('last_month', 'Last month'), ('this_fy', 'This FY'), ('last_fy', 'Last FY')])
          CountChip(l, null,
              selected: _same(_quick(k).$1, r.from) && _same(_quick(k).$2, r.to),
              onTap: () => setState(() {
                    final q = _quick(k);
                    r.from = q.$1;
                    r.to = q.$2;
                    _tick++;
                  })),
      ]),
      if (widget.note != null) padded(Text(widget.note!, style: const TextStyle(fontSize: 12, color: Brand.muted))),
      KeyedSubtree(key: ValueKey(_tick), child: widget.child()),
    ]);
  }
}

class _Balanced extends StatelessWidget {
  const _Balanced(this.ok, {this.okText = 'Balanced', this.badText = 'Out of balance'});
  final bool ok;
  final String okText;
  final String badText;

  @override
  Widget build(BuildContext context) => StatusBadge(ok ? '✓ $okText' : badText, color: ok ? _green : _red);
}

class _ReportTitle extends StatelessWidget {
  const _ReportTitle(this.title, {this.sub, this.right});
  final String title;
  final String? sub;
  final Widget? right;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Brand.heading)),
              if (sub != null) Text(sub!, style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
          ),
          ?right,
        ]),
      );
}

/// One line of a vertical statement (P&L / BS / Cash Flow).
class _Stmt extends StatelessWidget {
  const _Stmt(this.label, this.amount, {this.level = 0, this.bold = false, this.heading = false, this.total = false, this.tone, this.muted = false, this.onTap, this.open});
  final String label;
  final Object? amount;
  final int level;
  final bool bold;
  final bool heading;
  final bool total;
  final Color? tone;
  final bool muted;
  final VoidCallback? onTap;
  final bool? open;

  @override
  Widget build(BuildContext context) {
    final w = heading || bold || total ? FontWeight.w700 : FontWeight.w500;
    final n = toNum(amount);
    final color = tone ?? (n != null && n < 0 ? _red : (muted ? Brand.muted : Brand.body));
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.fromLTRB(12.0 + level * 14, 8, 12, 8),
        decoration: BoxDecoration(
          color: heading ? Brand.primarySoft : null,
          border: total ? const Border(top: BorderSide(color: Brand.border, width: 2)) : null,
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (onTap != null) Icon(open == true ? Icons.expand_more_rounded : Icons.chevron_right_rounded, size: 16, color: Brand.muted),
          Expanded(
            child: Text(heading ? label.toUpperCase() : label,
                style: TextStyle(fontSize: muted ? 12 : 13, fontWeight: w, color: muted ? Brand.muted : Brand.body)),
          ),
          const SizedBox(width: 8),
          Text(amount == null ? '' : inr(amount), style: TextStyle(fontSize: muted ? 12 : 13, fontWeight: w, color: color)),
        ]),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card(this.children);
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Card(clipBehavior: Clip.antiAlias, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children)),
      );
}

/// A Schedule III head with its ledgers folded underneath.
class _Head extends StatefulWidget {
  const _Head(this.head, {this.label, this.level = 0});
  final Json head;
  final String? label;
  final int level;

  @override
  State<_Head> createState() => _HeadState();
}

class _HeadState extends State<_Head> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final ledgers = listOf(widget.head['ledgers']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Stmt(widget.label ?? '${widget.head['label']}', widget.head['amount'],
          level: widget.level, onTap: ledgers.isEmpty ? null : () => setState(() => _open = !_open), open: _open),
      if (_open)
        for (final l in ledgers)
          _Stmt('${l['code'] != null ? '${l['code']} — ' : ''}${l['name']}', l['amount'], level: widget.level + 1, muted: true),
    ]);
  }
}

// ── Trial balance ────────────────────────────────────────────────────────────

class _TrialBalance extends StatelessWidget {
  const _TrialBalance({required this.r});
  final _Range r;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => asJson(await Api.get('/accounts/reports/trial-balance', query: {'from_date': apiDate(r.from), 'to_date': apiDate(r.to)})),
        builder: (ctx, tb, _) {
          final rows = listOf(tb['rows']);
          final groups = <String, List<Json>>{};
          for (final x in rows) {
            groups.putIfAbsent('${x['primary_group'] ?? 'Ungrouped ledgers'}', () => []).add(x);
          }
          final totals = asJson(tb['totals']);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _ReportTitle('Trial Balance',
                sub: '${fmtDate(tb['from_date'])} to ${fmtDate(tb['to_date'])} · tap a ledger to see its statement',
                right: _Balanced(tb['is_balanced'] == true)),
            if (rows.isEmpty) const EmptyView('No postings in this range.'),
            for (final g in groups.entries) ...[
              SectionTitle(g.key),
              for (final x in g.value)
                RecordCard(
                  code: '${x['code']}',
                  title: '${x['name']}',
                  subtitle: x['group_name'] as String?,
                  meta: [
                    ('Opening', drcr(toD(x['opening_debit']) - toD(x['opening_credit']))),
                    ('Debit', inr(x['debit'])),
                    ('Credit', inr(x['credit'])),
                    ('Closing', drcr(toD(x['closing_debit']) - toD(x['closing_credit']))),
                  ],
                  onTap: () => openScreen(ctx, _LedgerDrill(row: x, r: r)),
                ),
            ],
            if (totals.isNotEmpty)
              DetailSection('Total', children: [
                AmountRow('Opening Dr / Cr', '${inr(totals['opening_debit'])} / ${inr(totals['opening_credit'])}'),
                AmountRow('Debit / Credit', '${inr(totals['debit'])} / ${inr(totals['credit'])}', bold: true),
                AmountRow('Closing Dr / Cr', '${inr(totals['closing_debit'])} / ${inr(totals['closing_credit'])}', bold: true),
              ]),
            const InfoBanner(
                "Every double entry has equal debits and credits, so the Debit and Credit columns — and the closing Dr and Cr columns — must "
                "total the same. If they don't, something was posted outside the ledger engine and should be investigated before reports are relied on."),
          ]);
        },
      );
}

class _LedgerDrill extends StatelessWidget {
  const _LedgerDrill({required this.row, required this.r});
  final Json row;
  final _Range r;

  @override
  Widget build(BuildContext context) => SubPage(
        title: '${row['code']} — ${row['name']}',
        body: ApiLoader<Json>(
          load: () async => asJson(await Api.get('/accounts/reports/gl-ledger',
              query: {'gl_account_id': row['gl_account_id'], 'from_date': apiDate(r.from), 'to_date': apiDate(r.to)})),
          builder: (ctx, d, _) => ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            padded(Text(
                'Ledger statement · ${fmtDate(r.from)} to ${fmtDate(r.to)}${row['group_name'] != null ? ' · ${row['group_name']}' : ''}',
                style: const TextStyle(color: Brand.muted))),
            FinLedgerStatementView(data: d),
          ]),
        ),
      );
}

// ── P&L ──────────────────────────────────────────────────────────────────────

class _ProfitLoss extends StatelessWidget {
  const _ProfitLoss({required this.r});
  final _Range r;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => asJson(await Api.get('/accounts/reports/profit-and-loss', query: {'from_date': apiDate(r.from), 'to_date': apiDate(r.to)})),
        builder: (ctx, pl, _) {
          Json? find(String h) {
            for (final x in listOf(pl['income'])) {
              if (x['head'] == h) return x;
            }
            return null;
          }

          final rev = find('revenue_from_operations');
          final other = find('other_income');
          final profit = toD(pl['profit_for_period']);
          final pbt = toD(pl['profit_before_tax']);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            StatGrid([
              StatCard('Total income', inr(pl['total_income'])),
              StatCard('Total expenses', inr(pl['total_expenses'])),
              StatCard('Gross profit (trading)', inr(pl['gross_profit']), tone: toD(pl['gross_profit']) >= 0 ? _green : _red),
              StatCard(profit >= 0 ? 'Profit for the period' : 'Loss for the period', inr(profit), tone: profit >= 0 ? _green : _red),
            ]),
            _ReportTitle('Statement of Profit and Loss',
                sub: 'For the period ${fmtDate(pl['from_date'])} to ${fmtDate(pl['to_date'])} · Schedule III, Division I · tap a head to see its ledgers'),
            _Card([
              if (rev != null) _Head(rev, label: 'I. ${rev['label']}'),
              if (other != null) _Head(other, label: 'II. ${other['label']}'),
              _Stmt('III. Total income (I + II)', pl['total_income'], total: true),
              const _Stmt('IV. Expenses', null, heading: true),
              for (final h in listOf(pl['expenses'])) _Head(h, level: 1),
              _Stmt('Total expenses (IV)', pl['total_expenses'], total: true),
              _Stmt('V. Profit before tax (III − IV)', pbt, bold: true, tone: pbt >= 0 ? _green : _red),
              if (pl['tax_expense'] is Map) _Head(asJson(pl['tax_expense']), label: 'VI. ${asJson(pl['tax_expense'])['label']}'),
              _Stmt('VII. ${profit >= 0 ? 'Profit' : 'Loss'} for the period (V − VI)', profit, total: true, tone: profit >= 0 ? _green : _red),
            ]),
            const InfoBanner(
                'Gross profit is the trading view: sales less direct costs (ledgers in groups marked "affects gross profit" — purchases, '
                'direct expenses, stock change). The Schedule III statement above is the statutory format; cost of materials consumed there is '
                'opening stock + purchases − closing stock, so post the closing-stock voucher before reading month-end profit.'),
          ]);
        },
      );
}

// ── Balance sheet ────────────────────────────────────────────────────────────

const _roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

class _BalanceSheet extends StatelessWidget {
  const _BalanceSheet({required this.r});
  final _Range r;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => asJson(await Api.get('/accounts/reports/balance-sheet', query: {'as_of': apiDate(r.to)})),
        builder: (ctx, bs, _) {
          final ok = bs['is_balanced'] == true;
          final sections = listOf(bs['sections']);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _ReportTitle('Balance Sheet',
                sub:
                    'As at ${fmtDate(bs['as_of'])} · Schedule III, Division I · tap a head to see its ledgers${ok ? '' : ' · Difference ${inr(bs['difference'])}'}',
                right: _Balanced(ok)),
            _Card([
              for (var si = 0; si < sections.length; si++) ...[
                _Stmt('${_roman[si % _roman.length]}. ${sections[si]['label']}', null, heading: true),
                for (final (ui, sub) in listOf(sections[si]['subsections']).indexed) ...[
                  _Stmt('(${ui + 1}) ${sub['label']}', null, level: 1, bold: true),
                  () {
                    final heads =
                        listOf(sub['heads']).where((h) => listOf(h['ledgers']).isNotEmpty || toD(h['amount']).abs() >= 0.005).toList();
                    if (heads.isEmpty) return const _Stmt('—', 0, level: 2, muted: true);
                    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      for (final (hi, h) in heads.indexed) _Head(h, label: '(${String.fromCharCode(97 + hi)}) ${h['label']}', level: 2),
                    ]);
                  }(),
                  _Stmt('Total ${'${sub['label']}'.toLowerCase()}', sub['amount'], level: 1, bold: true, muted: true),
                ],
                _Stmt('Total ${'${sections[si]['label']}'.toLowerCase()}', sections[si]['amount'], total: true, tone: ok ? _green : _red),
              ],
            ]),
            if (toD(bs['profit_and_loss_surplus']).abs() >= 0.005)
              InfoBanner(
                  "Surplus in the Statement of Profit & Loss (not yet closed) — ${inr(bs['profit_and_loss_surplus'])} is the "
                  "cumulative income minus expenses that hasn't yet been transferred to Retained Earnings by a year-end close. It is shown "
                  'inside Reserves and Surplus so the sheet balances; running Year-end Close moves it into Retained Earnings permanently.'),
            if (!ok)
              InfoBanner(
                  'Assets differ from Equity & Liabilities by ${inr(bs['difference'])}. Check the Trial Balance for the same range — if it is '
                  'balanced, a ledger is probably mapped to the wrong account group (Finance > Masters > Account Groups).',
                  tone: Tone.warning),
          ]);
        },
      );
}

// ── Cash flow ────────────────────────────────────────────────────────────────

class _CashFlow extends StatelessWidget {
  const _CashFlow({required this.r});
  final _Range r;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => asJson(await Api.get('/accounts/reports/cash-flow', query: {'from_date': apiDate(r.from), 'to_date': apiDate(r.to)})),
        builder: (ctx, cf, _) {
          final ok = toD(cf['difference']).abs() < 0.005;
          List<Widget> block(String title, String key, String netKey, String netLabel) => [
                _Stmt(title, null, heading: true),
                for (final l in listOf(cf[key])) _Stmt('${l['label']}', l['amount'], level: 1, muted: toD(l['amount']).abs() < 0.005),
                _Stmt(netLabel, cf[netKey], total: true),
              ];
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _ReportTitle('Cash Flow Statement (indirect method, AS-3)',
                sub: 'For the period ${fmtDate(cf['from_date'])} to ${fmtDate(cf['to_date'])}',
                right: _Balanced(ok, okText: 'Reconciles to cash', badText: "Doesn't reconcile — difference ${inr(cf['difference'])}")),
            _Card([
              ...block('A. Cash flow from operating activities', 'operating', 'net_operating', 'Net cash from operating activities (A)'),
              ...block('B. Cash flow from investing activities', 'investing', 'net_investing', 'Net cash from investing activities (B)'),
              ...block('C. Cash flow from financing activities', 'financing', 'net_financing', 'Net cash from financing activities (C)'),
              _Stmt('Net increase/(decrease) in cash and cash equivalents (A + B + C)', cf['net_change'], bold: true),
              _Stmt('Cash and cash equivalents at the beginning of the period', cf['opening_cash']),
              _Stmt('Cash and cash equivalents at the end of the period', cf['closing_cash'], total: true),
              _Stmt(ok ? '✓ Check: opening cash + net change = closing cash' : '✗ Check: opening cash + net change ≠ closing cash',
                  cf['difference'],
                  tone: ok ? _green : _red, bold: true),
            ]),
            const InfoBanner(
                'The indirect method starts from profit before tax, adds back non-cash charges (depreciation) and adjusts for changes in '
                'working capital — an increase in receivables or stock uses cash, an increase in payables provides it. Because every line is '
                'derived from Balance Sheet movements, the statement must reconcile exactly to the change in cash and bank balances.'),
          ]);
        },
      );
}

// ── Aging ────────────────────────────────────────────────────────────────────

const kAgingBuckets = [('not_due', 'Not due'), ('1_30', '1–30'), ('31_60', '31–60'), ('61_90', '61–90'), ('over_90', '> 90')];
const kBucketLabels = {'not_due': 'Not due', '1_30': '1–30 days', '31_60': '31–60 days', '61_90': '61–90 days', 'over_90': '90+ days'};
const kBucketHex = {
  'not_due': _green, '1_30': Color(0xFFF59E0B), '31_60': Color(0xFFB45309), '61_90': _red, 'over_90': Color(0xFF991B1B),
};

class _Aging extends StatefulWidget {
  const _Aging();

  @override
  State<_Aging> createState() => _AgingState();
}

class _AgingState extends State<_Aging> {
  bool _ar = true;

  @override
  Widget build(BuildContext context) {
    final word = _ar ? 'Customer' : 'Vendor';
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      ChipRow([
        CountChip('Receivables (AR)', null, selected: _ar, onTap: () => setState(() => _ar = true)),
        CountChip('Payables (AP)', null, selected: !_ar, onTap: () => setState(() => _ar = false)),
      ]),
      InfoBanner(
          'Aging is a point-in-time view as of today: each unpaid posted invoice is placed in a bucket by days past its due date. '
          'Advances (unallocated payments and ${_ar ? 'credit' : 'debit'} notes) are shown separately — allocate them against bills in '
          'Payments so the outstanding is net. Party statements are under Finance › Outstanding.'),
      ApiLoader<Json>(
        key: ValueKey(_ar),
        load: () async => asJson(await Api.get(_ar ? '/accounts/reports/ar-aging' : '/accounts/reports/ap-aging')),
        builder: (ctx, rep, _) {
          final parties = listOf(rep['parties']);
          final rows = listOf(rep['rows']);
          final totals = asJson(rep['totals']);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _ReportTitle('${_ar ? 'Accounts receivable' : 'Accounts payable'} — party-wise aging', sub: 'Amount (₹) as of ${fmtDate(DateTime.now())}'),
            if (parties.isEmpty) padded(Text('No ${word.toLowerCase()} has anything outstanding.', style: const TextStyle(color: Brand.muted))),
            for (final p in parties)
              RecordCard(
                title: '${p['party_name']}',
                subtitle: '${p['open_bills']} bill(s)',
                meta: [
                  for (final (k, l) in kAgingBuckets)
                    if (toD(p[k]) != 0) (l, inr(p[k])),
                  ('Outstanding', inr(p['outstanding'])),
                  if (toD(p['advances']) != 0) ('Advances', inr(p['advances'])),
                  ('Net', inr(p['net'])),
                ],
              ),
            if (parties.isNotEmpty)
              DetailSection('Total', children: [
                for (final (k, l) in kAgingBuckets) AmountRow(l, inr(totals[k] ?? 0)),
                AmountRow('Outstanding', inr(totals['outstanding'] ?? 0), bold: true),
                AmountRow('Advances', inr(totals['advances'] ?? 0)),
                AmountRow('Net', inr(totals['net'] ?? 0), bold: true),
              ]),
            const _ReportTitle('Bill-wise detail', sub: 'Oldest due first'),
            if (rows.isEmpty) padded(const Text('No open bills.', style: TextStyle(color: Brand.muted))),
            for (final x in rows)
              RecordCard(
                code: '${x['invoice_number']}',
                title: '${x['party_name']}',
                trailing: Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: FinStatusPill(x['bucket'], labels: kBucketLabels, colors: kBucketHex)),
                meta: [
                  ('Due date', fmtDate(x['due_date'])),
                  if ((toInt(x['days_overdue']) ?? 0) > 0) ('Days overdue', '${x['days_overdue']}'),
                  ('Amount due', inr(x['amount_due'])),
                ],
              ),
            if (rows.isNotEmpty) DetailSection('Total due', children: [AmountRow('Total due', inr(rep['total_due']), bold: true)]),
          ]);
        },
      ),
    ]);
  }
}

// ── Budget variance ──────────────────────────────────────────────────────────

class _Variance extends StatelessWidget {
  const _Variance({required this.r});
  final _Range r;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => asJson(await Api.get('/accounts/reports/variance-analysis', query: {'from_date': apiDate(r.from), 'to_date': apiDate(r.to)})),
        builder: (ctx, v, _) {
          final rows = listOf(v['rows']);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const InfoBanner(
                "Budget vs actual for the selected range. A cost centre's annual budget is pro-rated to the number of months "
                "in the range (3 months = 3/12 of the budget; the full FY = the full budget). An internal order's budget covers its whole "
                "life, so it's compared life to date. Positive variance = spent more than budgeted (red). Tap an internal order to see its line items and open POs."),
            _ReportTitle('Budget variance', sub: '${fmtDate(v['from_date'])} to ${fmtDate(v['to_date'])}'),
            if (rows.isEmpty) padded(Text('${v['note'] ?? 'Nothing to compare.'}', style: const TextStyle(color: Brand.muted))),
            for (final x in rows)
              RecordCard(
                code: '${x['code']}',
                title: '${x['name']}',
                subtitle: x['type'] == 'cost_center' ? 'Cost centre' : 'Internal order',
                meta: [
                  ('Budget', inr(x['budgeted_amount'])),
                  ('Actual', inr(x['actual_amount'])),
                  ('Variance', inr(x['variance'])),
                  ('Variance %', x['variance_pct'] != null ? '${toD(x['variance_pct']).toStringAsFixed(1)}%' : '—'),
                ],
                trailing: StatusBadge(toD(x['variance']) > 0.005 ? 'Over' : 'Within', color: toD(x['variance']) > 0.005 ? _red : _green),
                onTap: x['type'] == 'internal_order' && x['id'] != null
                    ? () => openScreen(ctx, _IoScreen(id: toInt(x['id'])!, to: r.to))
                    : null,
              ),
          ]);
        },
      );
}

// ── Cost centres ─────────────────────────────────────────────────────────────

class _CostCentres extends StatefulWidget {
  const _CostCentres({required this.r});
  final _Range r;

  @override
  State<_CostCentres> createState() => _CostCentresState();
}

class _CostCentresState extends State<_CostCentres> {
  int? _cc;
  String? _ccLabel;
  bool _subs = true;

  void _drill(int ccId, bool children, int? glId, String label) => openScreen(
        context,
        SubPage(
          title: 'Line items',
          body: ApiLoader<Json>(
            load: () async => asJson(await Api.get('/accounts/reports/cost-center-line-items', query: {
              'cost_center_id': ccId,
              'include_children': children,
              'gl_account_id': glId,
              'from_date': apiDate(widget.r.from),
              'to_date': apiDate(widget.r.to),
            })),
            builder: (ctx, d, _) => ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
              padded(Text(label, style: const TextStyle(fontWeight: FontWeight.w700))),
              FinLineItems(data: d),
            ]),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const InfoBanner(
          'Actual costs and revenues (debit minus credit) on P&L ledgers, per cost centre, for the selected range. Tap an amount to see '
          'its line items and open the voucher. "Unassigned" = P&L postings with no cost centre — set "Cost object required" or a '
          'default cost centre on the ledger (Finance › Masters › Ledgers) to stop them.'),
      padded(AppSelect<int>(
        label: 'Cost centre',
        value: _cc,
        valueLabel: _ccLabel ?? (_cc == null ? 'All cost centres' : null),
        loadOptions: (q) async {
          final rows = asRows(await Api.get('/organization/cost-centers'));
          return [
            for (final c in rows)
              if (q.isEmpty || '${c['code']} ${c['name']}'.toLowerCase().contains(q.toLowerCase()))
                Option(toInt(c['id'])!, '${c['code']} — ${c['name']}${c['status'] != 'active' ? ' (inactive)' : ''}'),
          ];
        },
        onChanged: (o) => setState(() {
          _cc = o?.value;
          _ccLabel = o?.label;
        }),
      )),
      if (_cc != null)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Row(children: [
            Expanded(child: CheckField(label: 'Include sub-centres', value: _subs, onChanged: (v) => setState(() => _subs = v))),
            TextButton(
                onPressed: () => _drill(_cc!, _subs, null, '${_ccLabel ?? ''}${_subs ? ' (with sub-centres)' : ''}'),
                child: const Text('All line items')),
          ]),
        ),
      ApiLoader<Json>(
        key: ValueKey('$_cc$_subs'),
        load: () async => asJson(await Api.get('/accounts/reports/cost-center-actuals', query: {
          'from_date': apiDate(widget.r.from),
          'to_date': apiDate(widget.r.to),
          'cost_center_id': _cc,
          'include_children': _subs,
        })),
        builder: (ctx, a, _) {
          final cols = listOf(a['cost_centers']);
          final rows = listOf(a['rows']);
          final ct = asJson(a['column_totals']);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (rows.isEmpty) const EmptyView('No P&L postings in this range.'),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text('${r['gl_account_code']} — ${r['gl_account_name']}${r['account_type'] == 'revenue' ? ' (income)' : ''}',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      for (final c in cols)
                        if (toD(asJson(r['amounts'])['${c['id']}']) != 0)
                          InkWell(
                            onTap: () => _drill(toInt(c['id'])!, false, toInt(r['gl_account_id']),
                                '${c['code']} — ${c['name']} · ${r['gl_account_code']} ${r['gl_account_name']}'),
                            child: AmountRow('${c['code']}', inr(asJson(r['amounts'])['${c['id']}']), color: Brand.primaryActive),
                          ),
                      if (_cc == null && toD(r['unassigned']) != 0) AmountRow('Unassigned', inr(r['unassigned']), color: _red),
                      AmountRow('Total', inr(r['total']), bold: true),
                    ]),
                  ),
                ),
              ),
            if (rows.isNotEmpty)
              DetailSection('Column totals', children: [
                for (final c in cols) AmountRow('${c['code']} — ${c['name']}', inr(ct['${c['id']}'] ?? 0)),
                if (_cc == null && toD(a['unassigned_total']) != 0) AmountRow('Unassigned', inr(a['unassigned_total']), color: _red),
              ]),
          ]);
        },
      ),
    ]);
  }
}

/// Line items (cost-centre / internal-order drill-down) with voucher links.
class FinLineItems extends StatelessWidget {
  const FinLineItems({super.key, required this.data});
  final Json data;

  @override
  Widget build(BuildContext context) {
    final rows = listOf(data['rows']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (rows.isEmpty) const EmptyView('No line items.'),
      for (final r in rows)
        RecordCard(
          code: '${r['entry_number']}',
          title: '${r['gl_account_code']} — ${r['gl_account_name']}',
          subtitle: (r['description'] ?? '').toString().isEmpty ? null : '${r['description']}',
          meta: [
            ('Date', fmtDate(r['posting_date'])),
            if (r['cost_center_code'] != null) ('Cost centre', '${r['cost_center_code']}'),
            if (r['internal_order_code'] != null) ('Order', '${r['internal_order_code']}'),
            if (r['party_name'] != null) ('Party', '${r['party_name']}'),
            if (toD(r['debit_amount']) != 0) ('Debit', inr(r['debit_amount'])),
            if (toD(r['credit_amount']) != 0) ('Credit', inr(r['credit_amount'])),
            if (r['running_balance'] != null) ('Running', inr(r['running_balance'])),
          ],
          onTap: r['journal_entry_id'] == null ? null : () => openScreen(context, FinVoucherScreen(entryId: toInt(r['journal_entry_id'])!)),
        ),
    ]);
  }
}

// ── Internal orders ──────────────────────────────────────────────────────────

const kIoStatusLabels = {'open': 'Open', 'in_progress': 'In progress', 'completed': 'Completed', 'closed': 'Closed'};

class _InternalOrders extends StatefulWidget {
  const _InternalOrders({required this.r});
  final _Range r;

  @override
  State<_InternalOrders> createState() => _InternalOrdersState();
}

class _InternalOrdersState extends State<_InternalOrders> {
  String? _status;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const InfoBanner(
            'Budget vs actual for each internal order over its whole life (up to the "to" date). Commitment = issued purchase orders '
            'that carry the order, less what has already been invoiced and posted. Available = budget − actual − commitment.'),
        padded(AppSelect<String>(
          label: 'Status',
          value: _status,
          options: [for (final e in kIoStatusLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setState(() => _status = o?.value),
        )),
        ApiLoader<Json>(
          key: ValueKey(_status),
          load: () async =>
              asJson(await Api.get('/accounts/reports/internal-orders', query: {'to_date': apiDate(widget.r.to), 'status': _status})),
          builder: (ctx, d, _) {
            final rows = listOf(d['rows']);
            return Column(children: [
              if (rows.isEmpty) const EmptyView('No internal orders.'),
              for (final x in rows)
                RecordCard(
                  code: '${x['code']}',
                  title: '${x['name']}',
                  subtitle: x['cost_center_name'] as String?,
                  status: kIoStatusLabels['${x['status']}'] ?? x['status'],
                  meta: [
                    ('Budget', inr(x['budgeted_amount'])),
                    ('Actual', inr(x['actual_amount'])),
                    ('Commitment', inr(x['commitment_amount'])),
                    ('Available', inr(x['available_amount'])),
                    ('Used %', x['consumed_pct'] != null ? '${toD(x['consumed_pct']).toStringAsFixed(1)}%' : '—'),
                  ],
                  onTap: () => openScreen(ctx, _IoScreen(id: toInt(x['id'])!, to: widget.r.to)),
                ),
            ]);
          },
        ),
      ]);
}

class _IoScreen extends StatelessWidget {
  const _IoScreen({required this.id, required this.to});
  final int id;
  final DateTime to;

  @override
  Widget build(BuildContext context) => SubPage(
        title: 'Internal order',
        body: ApiLoader<Json>(
          load: () async => asJson(await Api.get('/accounts/reports/internal-orders/$id', query: {'to_date': apiDate(to)})),
          builder: (ctx, rep, _) {
            final s = asJson(rep['summary']);
            final avail = toNum(s['available_amount']);
            return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
              _ReportTitle('${s['code']} — ${s['name']}', sub: '${fmtDate(s['start_date'])} to ${fmtDate(s['end_date'])}'),
              StatGrid([
                StatCard('Budget', inr(s['budgeted_amount'])),
                StatCard('Actual (life to date)', inr(s['actual_amount'])),
                StatCard('Commitment (open POs)', inr(s['commitment_amount'])),
                StatCard('Available', inr(avail), tone: avail != null && avail < 0 ? _red : null),
              ]),
              if (listOf(rep['commitments']).isNotEmpty) ...[
                const SectionTitle('Purchase orders'),
                for (final c in listOf(rep['commitments']))
                  RecordCard(
                    code: '${c['po_number']}',
                    title: txt(c['vendor_name']),
                    status: c['status'],
                    meta: [
                      ('Date', fmtDate(c['po_date'])),
                      ('PO value', inr(c['po_value'] ?? c['amount'])),
                      ('Invoiced', inr(c['invoiced_amount'] ?? c['invoiced'])),
                      ('Open', inr(c['open_amount'] ?? c['open'])),
                    ],
                  ),
              ],
              if (listOf(rep['by_ledger']).isNotEmpty)
                DetailSection('By ledger', children: [
                  for (final g in listOf(rep['by_ledger'])) AmountRow('${g['gl_account_code']} — ${g['gl_account_name']}', inr(g['amount'])),
                ]),
              const SectionTitle('Line items'),
              FinLineItems(data: asJson(rep['line_items'])),
            ]);
          },
        ),
      );
}

// ── Monthly pack ─────────────────────────────────────────────────────────────

class _MonthlyPack extends StatefulWidget {
  const _MonthlyPack();

  @override
  State<_MonthlyPack> createState() => _MonthlyPackState();
}

class _MonthlyPackState extends State<_MonthlyPack> {
  String _period = currentPeriod();

  List<String> get _periods {
    final d = DateTime.now();
    return [
      for (var i = 0; i < 24; i++) '${DateTime(d.year, d.month - i, 1).year}-${DateTime(d.year, d.month - i, 1).month.toString().padLeft(2, '0')}',
    ];
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        padded(AppSelect<String>(
          label: 'Month',
          value: _period,
          clearable: false,
          options: [for (final p in _periods) Option(p, periodLabel(p))],
          onChanged: (o) => setState(() => _period = o?.value ?? _period),
        )),
        padded(const Text('The one-page summary to review at month-end close.', style: TextStyle(fontSize: 12, color: Brand.muted))),
        ApiLoader<Json>(
          key: ValueKey(_period),
          load: () async => asJson(await Api.get('/accounts/reports/monthly-pack', query: {'period': _period})),
          builder: (ctx, p, _) {
            final tb = asJson(p['trial_balance']);
            final tbt = asJson(tb['totals']);
            final pl = asJson(p['profit_and_loss']);
            final bs = asJson(p['balance_sheet']);
            final profit = toD(pl['profit_for_period']);
            return Column(children: [
              DetailSection('Trial balance', action: _Balanced(tb['is_balanced'] == true), children: [
                AmountRow('Total debit', inr(tbt['debit'])),
                AmountRow('Total credit', inr(tbt['credit'])),
                AmountRow('Closing Dr', inr(tbt['closing_debit'])),
                AmountRow('Closing Cr', inr(tbt['closing_credit'])),
              ]),
              DetailSection('Profit & loss', children: [
                AmountRow('Total income', inr(pl['total_income'])),
                AmountRow('Total expenses', inr(pl['total_expenses'])),
                AmountRow('Gross profit', inr(pl['gross_profit'])),
                AmountRow('Profit before tax', inr(pl['profit_before_tax'])),
                AmountRow('Profit for the period', inr(profit), bold: true, color: profit >= 0 ? _green : _red),
              ]),
              DetailSection('Balance sheet as at ${fmtDate(bs['as_of'])}', action: _Balanced(bs['is_balanced'] == true), children: [
                AmountRow('Total assets', inr(bs['total_assets'])),
                AmountRow('Total equity & liabilities', inr(bs['total_equity_and_liabilities'])),
                AmountRow('P&L surplus not yet closed', inr(bs['profit_and_loss_surplus'])),
                if (bs['is_balanced'] != true) AmountRow('Difference', inr(bs['difference']), color: _red),
              ]),
              DetailSection('Receivables / payables aging', children: [
                for (final side in const ['ar', 'ap']) ...[
                  Caps(side == 'ar' ? 'Receivables (AR)' : 'Payables (AP)'),
                  () {
                    final a = asJson(p[side == 'ar' ? 'ar_aging' : 'ap_aging']);
                    final t = asJson(a['totals']);
                    final n = listOf(a['rows']).length;
                    return Column(children: [
                      AmountRow('Outstanding ($n bill${n == 1 ? '' : 's'})', inr(a['total_due'])),
                      AmountRow('Overdue', inr(t['overdue'] ?? 0), color: toD(t['overdue']) > 0 ? _red : null),
                      AmountRow('Over 90 days', inr(t['over_90'] ?? 0)),
                    ]);
                  }(),
                ],
              ]),
              if (p['aging_note'] != null) InfoBanner('${p['aging_note']}', tone: Tone.warning),
            ]);
          },
        ),
      ]);
}

// ── Year-end close ───────────────────────────────────────────────────────────

const _fyHex = {'open': _green, 'closed': Color(0xFF64748B), 'locked': Color(0xFFB45309)};

class _YearEnd extends StatefulWidget {
  const _YearEnd();

  @override
  State<_YearEnd> createState() => _YearEndState();
}

class _YearEndState extends State<_YearEnd> {
  String? _fy;
  int _tick = 0;
  bool _busy = false;

  Future<void> _close(String fy) async {
    final direct = isFinanceManager;
    final ok = await confirmDialog(context,
        title: 'Close financial year $fy?',
        message:
            'Closing posts one voucher on the FY end date that zeroes every income and expense ledger into Retained Earnings and marks the year closed — no further postings can be dated in it.',
        confirmLabel: direct ? 'Close financial year' : 'Request year-end close');
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      final res = asJson(await Api.post('/accounts/reports/year-end/close', query: {'fy_code': fy}));
      if (!mounted) return;
      await _message(
          res['approval_status'] == 'pending' ? 'Close of $fy submitted for approval' : 'Financial year $fy closed',
          res['approval_status'] == 'pending'
              ? '${res['message'] ?? 'A Finance Manager must approve it.'}'
              : 'Closing voucher ${res['entry_number']} posted. Income and expense ledgers are now zero for $fy; the result sits in Retained Earnings.');
    } catch (e) {
      if (mounted) showSnack(context, "Couldn't close financial year $fy. ${ApiClient.describe(e)}", error: true);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _tick++;
        });
      }
    }
  }

  Future<void> _reopen(String fy) async {
    final reason = await promptDialog(context,
        title: 'Reopen financial year $fy?',
        message: 'The closing voucher is reversed, not deleted. The reason goes on the audit trail.',
        label: 'Reason for reopening',
        confirmLabel: 'Reopen year');
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final res = asJson(await Api.post('/accounts/reports/year-end/reopen', query: {'fy_code': fy, 'reason': reason}));
      if (!mounted) return;
      await _message('Financial year $fy reopened',
          'The closing voucher was reversed by ${res['entry_number']}. Postings into $fy are allowed again — close the year again once the corrections are done.');
    } catch (e) {
      if (mounted) showSnack(context, "Couldn't reopen financial year $fy. ${ApiClient.describe(e)}", error: true);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _tick++;
        });
      }
    }
  }

  Future<void> _message(String title, String text) => showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
            title: Text(title), content: Text(text), actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))]),
      );

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      key: ValueKey('ye$_tick'),
      load: () async => asJson(await Api.get('/accounts/setup')),
      builder: (ctx, setup, _) {
        final fys = listOf(setup['financial_years']);
        _fy ??= asJson(setup['current_financial_year'])['code'] as String? ?? (fys.isNotEmpty ? '${fys.first['code']}' : null);
        Json? fy;
        for (final f in fys) {
          if (f['code'] == _fy) fy = f;
        }
        return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          const InfoBanner(
              'Before closing a year: (1) post or cancel every pending purchase/sales invoice, debit/credit note and draft '
              'journal dated in the year; (2) post the closing-stock valuation; (3) run depreciation up to the last month; (4) post the GST '
              'set-off for March. Closing posts one voucher on the FY end date that zeroes every income and expense ledger into Retained '
              'Earnings and marks the year closed — no further postings can be dated in it.',
              tone: Tone.warning),
          padded(AppSelect<String>(
            label: 'Financial year',
            value: _fy,
            clearable: false,
            options: [for (final f in fys) Option('${f['code']}', '${f['code']}${f['status'] != 'open' ? ' (${f['status']})' : ''}')],
            onChanged: (o) => setState(() => _fy = o?.value),
          )),
          if (fy != null)
            padded(Text(
                '${fmtDate(fy['start_date'])} to ${fmtDate(fy['end_date'])}${fy['lock_date'] != null ? ' · locked up to ${fmtDate(fy['lock_date'])}' : ''}',
                style: const TextStyle(fontSize: 12, color: Brand.muted))),
          if (_fy == null)
            const EmptyView('No financial years are set up — add one in Company Info > Financial Years.')
          else
            ApiLoader<Json>(
              key: ValueKey('yp$_fy$_tick'),
              load: () async => asJson(await Api.get('/accounts/reports/year-end', query: {'fy_code': _fy})),
              builder: (c2, pv, reload) {
                final closed = pv['closing_entry'] != null;
                final np = toD(pv['net_profit']);
                final code = '${pv['fy_code']}';
                return Column(children: [
                  _ReportTitle('Year-end close — $code',
                      sub: 'Closing date ${fmtDate(pv['end_date'])}', right: FinStatusPill(pv['status'], colors: _fyHex)),
                  StatGrid([
                    StatCard(np >= 0 ? 'Net profit for the year' : 'Net loss for the year', inr(np), tone: np >= 0 ? _green : _red),
                    StatCard('Closing voucher', '${pv['closing_entry'] ?? 'Not closed'}'),
                  ]),
                  padded(Text(
                      closed
                          ? 'This year was closed by ${pv['closing_entry']}. Its income and expense ledgers are zero and the result is in Retained Earnings. To correct something in $code, an admin must reopen it — the closing voucher is reversed, not deleted.'
                          : 'Closing will transfer the ${np >= 0 ? 'profit' : 'loss'} of ${inr(np.abs())} to Retained Earnings on ${fmtDate(pv['end_date'])}. The $code Statement of Profit & Loss stays readable afterwards (the closing voucher is excluded from it).',
                      style: const TextStyle(fontSize: 12.5, color: Brand.body, height: 1.5))),
                  padded(Align(
                    alignment: Alignment.centerLeft,
                    child: !closed
                        ? (finCan('year_end_close', 'approve')
                            ? actionBtn(isFinanceManager ? 'Close financial year' : 'Request year-end close', _busy ? null : () => _close(code),
                                primary: true)
                            : const Text('You need the Approve permission on Year-end Close to close a financial year.',
                                style: TextStyle(fontSize: 12, color: Brand.muted)))
                        : (Perm.user['role'] == 'admin'
                            ? actionBtn('Reopen year', _busy ? null : () => _reopen(code), danger: true)
                            : const Text('Only an admin can reopen a closed year.', style: TextStyle(fontSize: 12, color: Brand.muted))),
                  )),
                  if (int.tryParse(code.split('-').first) != null)
                    ApprovalPanel(
                        entityType: 'accounts_year_end_close',
                        entityId: int.parse(code.split('-').first),
                        title: 'Approval — close $code',
                        onChanged: () => setState(() => _tick++)),
                ]);
              },
            ),
        ]);
      },
    );
  }
}
