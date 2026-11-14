import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';

/// Finance › GST (portal finance/gst/page.tsx).
class FinGstPage extends StatelessWidget {
  const FinGstPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'GST',
        subtitle: 'GST registers, GSTR-1 / GSTR-3B working figures and the monthly input-credit set-off — prepared from posted invoices and notes.',
        tabs: [
          FinSubTab('Registers', (_) => const _Registers(), permTab: 'gst'),
          FinSubTab('GSTR-1', (_) => const _Gstr1(), visible: finCan('gst', 'view') && finCanFeature('gst', 'gstr1', 'view')),
          FinSubTab('GSTR-3B', (_) => const _Gstr3b(), visible: finCan('gst', 'view') && finCanFeature('gst', 'gstr3b', 'view')),
          FinSubTab('ITC Set-off', (_) => const _Setoff(), visible: finCan('gst', 'view') && finCanFeature('gst', 'itc_setoff', 'view')),
        ],
      );
}

const _docLabels = {'invoice': 'Invoice', 'credit_note': 'Credit note', 'debit_note': 'Debit note'};

/// Month picker (last 24 months) + Show/Refresh.
class FinPeriodPicker extends StatelessWidget {
  const FinPeriodPicker({super.key, required this.period, required this.onChanged, this.label = 'Return period (month)'});
  final String period;
  final ValueChanged<String> onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    final d = DateTime.now();
    final periods = [
      for (var i = 0; i < 24; i++) '${DateTime(d.year, d.month - i, 1).year}-${DateTime(d.year, d.month - i, 1).month.toString().padLeft(2, '0')}',
    ];
    return padded(AppSelect<String>(
      label: label,
      value: period,
      clearable: false,
      options: [for (final p in periods) Option(p, periodLabel(p))],
      onChanged: (o) => onChanged(o?.value ?? period),
    ));
  }
}

String _taxLine(Json r) => [
      if (toD(r['cgst']) != 0) 'CGST ${inr(r['cgst'])}',
      if (toD(r['sgst']) != 0) 'SGST ${inr(r['sgst'])}',
      if (toD(r['igst']) != 0) 'IGST ${inr(r['igst'])}',
    ].join(' · ');

// ── Registers ────────────────────────────────────────────────────────────────

class _Registers extends StatefulWidget {
  const _Registers();

  @override
  State<_Registers> createState() => _RegistersState();
}

class _RegistersState extends State<_Registers> {
  String _kind = 'sales';
  DateTime? _from = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime? _to = DateTime.now();
  int _tick = 0;

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        InfoBanner(_kind == 'sales'
            ? 'Output register: posted sales invoices and credit notes. Credit notes reduce your output tax, so they show as negative.'
            : 'Input register: posted purchase bills and debit notes. Debit notes (purchase returns) reverse input credit, so they show as negative.'),
        padded(AppSelect<String>(
          label: 'Register',
          value: _kind,
          clearable: false,
          options: const [Option('sales', 'Sales (output)'), Option('purchase', 'Purchase (input)')],
          onChanged: (o) => setState(() {
            _kind = o?.value ?? 'sales';
            _tick++;
          }),
        )),
        DateRangeRow(from: _from, to: _to, onChanged: (f, t) => setState(() {
              _from = f;
              _to = t;
            })),
        padded(Align(
            alignment: Alignment.centerRight,
            child: actionBtn('Show', _from == null || _to == null ? null : () => setState(() => _tick++), primary: true))),
        ApiLoader<Json>(
          key: ValueKey('r$_tick'),
          load: () async => asJson(await Api.get('/accounts/gst/register', query: {'kind': _kind, 'from_date': dateOrNull(_from), 'to_date': dateOrNull(_to)})),
          builder: (ctx, d, _) {
            final rows = listOf(d['rows']);
            final t = asJson(d['totals']);
            return Column(children: [
              if (rows.isEmpty) const EmptyView('No posted documents in this date range.'),
              for (final r in rows)
                RecordCard(
                  code: '${_docLabels['${r['doc_type']}'] ?? r['doc_type']} · ${r['doc_number']}',
                  title: txt(r['party_name']),
                  subtitle: '${r['gstin'] ?? 'Unregistered'} · POS ${r['place_of_supply'] ?? '—'}${r['reverse_charge'] == true ? ' · RCM' : ''}',
                  meta: [
                    ('Date', fmtDate(r['doc_date'])),
                    ('Taxable', inr(r['taxable'])),
                    ('Tax', _taxLine(r).isEmpty ? '—' : _taxLine(r)),
                    ('Total', inr(r['total'])),
                  ],
                ),
              if (rows.isNotEmpty)
                DetailSection('Total (${rows.length} documents)', children: [
                  AmountRow('Taxable', inr(t['taxable'])),
                  AmountRow('CGST', inr(t['cgst'])),
                  AmountRow('SGST', inr(t['sgst'])),
                  AmountRow('IGST', inr(t['igst'])),
                  AmountRow('Total', inr(t['total']), bold: true),
                ]),
            ]);
          },
        ),
      ]);
}

// ── GSTR-1 ───────────────────────────────────────────────────────────────────

class _Section extends StatefulWidget {
  const _Section({required this.title, required this.subtitle, required this.count, required this.children, this.open = false});
  final String title;
  final String subtitle;
  final int count;
  final List<Widget> children;
  final bool open;

  @override
  State<_Section> createState() => _SectionState();
}

class _SectionState extends State<_Section> {
  late bool _open = widget.open;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        child: Card(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ListTile(
              title: Text('${widget.title} (${widget.count})', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              subtitle: Text(widget.subtitle, style: const TextStyle(fontSize: 12)),
              trailing: Icon(_open ? Icons.expand_less_rounded : Icons.expand_more_rounded),
              onTap: () => setState(() => _open = !_open),
            ),
            if (_open)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: widget.children.isEmpty
                    ? const Text('Nothing to report in this section.', style: TextStyle(color: Brand.muted))
                    : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: widget.children),
              ),
          ]),
        ),
      );
}

Widget _docRow(Json r, bool invoice) {
  final rates = listOf(r['rates']);
  return Container(
    padding: const EdgeInsets.symmetric(vertical: 8),
    decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x140F172A)))),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${invoice ? r['invoice_number'] : r['note_number']} · ${fmtDate(invoice ? r['invoice_date'] : r['note_date'])}',
          style: const TextStyle(fontWeight: FontWeight.w600)),
      Text('${r['party_name'] ?? '—'} · ${r['gstin'] ?? '—'}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
      Text(
          invoice
              ? 'POS ${r['place_of_supply']} · RCM ${r['reverse_charge'] ?? 'N'}'
              : 'Against ${r['original_invoice_number'] ?? '—'}${r['original_invoice_date'] != null ? ' (${fmtDate(r['original_invoice_date'])})' : ''} · POS ${r['place_of_supply']}',
          style: const TextStyle(fontSize: 12, color: Brand.muted)),
      AmountRow(invoice ? 'Invoice value' : 'Note value', inr(invoice ? r['invoice_value'] : r['note_value']), bold: true),
      for (final rt in rates) AmountRow('${fmtNumber(rt['rate'])}% on ${inr(rt['taxable'])}', _taxLine(rt).isEmpty ? '—' : _taxLine(rt)),
    ]),
  );
}

class _Gstr1 extends StatefulWidget {
  const _Gstr1();

  @override
  State<_Gstr1> createState() => _Gstr1State();
}

class _Gstr1State extends State<_Gstr1> {
  String _period = currentPeriod();

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const InfoBanner(
            'GSTR-1 reports your outward supplies for the month. Invoices to registered buyers go invoice-wise in B2B; inter-state invoices to '
            'unregistered buyers above ₹1 lakh in B2CL; all other unregistered sales are summed by state and rate in B2CS. These are working '
            'figures to key into (or upload to) the GST portal — the filing itself happens there.'),
        FinPeriodPicker(period: _period, onChanged: (p) => setState(() => _period = p)),
        ApiLoader<Json>(
          key: ValueKey(_period),
          load: () async => asJson(await Api.get('/accounts/gst/gstr1', query: {'period': _period})),
          builder: (ctx, d, _) {
            final docs = asJson(d['documents']);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final w in (d['warnings'] is List ? d['warnings'] as List : const [])) InfoBanner('$w', tone: Tone.warning),
              _Section(
                  title: '4A — B2B invoices',
                  subtitle: 'Supplies to registered persons, invoice-wise with rate breakup',
                  count: listOf(d['b2b']).length,
                  open: true,
                  children: [for (final r in listOf(d['b2b'])) _docRow(r, true)]),
              _Section(
                  title: '5 — B2C Large (B2CL)',
                  subtitle: 'Inter-state invoices to unregistered buyers above ₹1,00,000',
                  count: listOf(d['b2cl']).length,
                  children: [for (final r in listOf(d['b2cl'])) _docRow(r, true)]),
              _Section(
                  title: '7 — B2C Small (B2CS)',
                  subtitle: 'Other unregistered sales, aggregated by place of supply and rate',
                  count: listOf(d['b2cs']).length,
                  children: [
                    for (final r in listOf(d['b2cs']))
                      AmountRow('${r['place_of_supply']} · ${r['type'] == 'INTER' ? 'Inter-state' : 'Intra-state'} · ${fmtNumber(r['rate'])}% on ${inr(r['taxable'])}',
                          _taxLine(r).isEmpty ? '—' : _taxLine(r)),
                  ]),
              _Section(
                  title: '9B — Credit notes, registered (CDNR)',
                  subtitle: 'Credit notes issued to registered buyers',
                  count: listOf(d['cdnr']).length,
                  children: [for (final r in listOf(d['cdnr'])) _docRow(r, false)]),
              _Section(
                  title: '9B — Credit notes, unregistered (CDNUR)',
                  subtitle: 'Credit notes issued to unregistered buyers',
                  count: listOf(d['cdnur']).length,
                  children: [for (final r in listOf(d['cdnur'])) _docRow(r, false)]),
              _Section(
                  title: '12 — HSN-wise summary',
                  subtitle: 'Net of credit notes; quantity in the unit quantity code (UQC)',
                  count: listOf(d['hsn_summary']).length,
                  children: [
                    for (final r in listOf(d['hsn_summary']))
                      AmountRow(
                          '${r['hsn_sac'] == '—' ? 'Missing' : r['hsn_sac']} · ${r['uqc']} · ${fmtNumber(r['rate'])}% · qty ${fmtNumber(r['quantity'])} · ${inr(r['taxable'])}',
                          _taxLine(r).isEmpty ? '—' : _taxLine(r),
                          color: r['hsn_sac'] == '—' ? const Color(0xFFB45309) : null),
                  ]),
              _Section(
                  title: '13 — Documents issued',
                  subtitle: 'Sales invoice number series used in the month',
                  count: toInt(docs['total_issued']) ?? 0,
                  open: true,
                  children: [
                    const FieldRow('Nature of document', 'Invoices for outward supply'),
                    FieldRow('Sr. no. from', docs['invoices_from']),
                    FieldRow('Sr. no. to', docs['invoices_to']),
                    AmountRow('Total issued', '${docs['total_issued'] ?? 0}'),
                    AmountRow('Cancelled', '${docs['cancelled'] ?? 0}'),
                    AmountRow('Net issued', '${(toInt(docs['total_issued']) ?? 0) - (toInt(docs['cancelled']) ?? 0)}', bold: true),
                  ]),
            ]);
          },
        ),
      ]);
}

// ── GSTR-3B ──────────────────────────────────────────────────────────────────

const _r3bRows = [
  ('3.1(a)', 'Outward taxable supplies (other than zero / nil rated / exempt)', 'outward_taxable_3_1_a', true, false),
  ('3.1(c)', 'Other outward supplies (nil rated, exempt)', 'outward_nil_rated_3_1_c', true, false),
  ('3.1(d)', 'Inward supplies liable to reverse charge', 'inward_reverse_charge_3_1_d', true, false),
  ('4(A)(3)', 'ITC — inward supplies liable to reverse charge', 'itc_reverse_charge_4_a_3', false, false),
  ('4(A)(5)', 'ITC — all other ITC', 'itc_all_other_4_a_5', false, false),
  ('4(B)', 'ITC reversed (debit notes / purchase returns)', 'itc_reversed_4_b', false, false),
  ('4(C)', 'Net ITC available (A − B)', 'net_itc_4_c', false, true),
];

class _Gstr3b extends StatefulWidget {
  const _Gstr3b();

  @override
  State<_Gstr3b> createState() => _Gstr3bState();
}

class _Gstr3bState extends State<_Gstr3b> {
  String _period = currentPeriod();

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const InfoBanner(
            'GSTR-3B is the monthly summary return on which tax is actually paid. Table 3.1 is your tax liability (outward supplies plus '
            'reverse-charge purchases); table 4 is the input credit you claim against it.'),
        FinPeriodPicker(period: _period, onChanged: (p) => setState(() => _period = p)),
        ApiLoader<Json>(
          key: ValueKey(_period),
          load: () async => asJson(await Api.get('/accounts/gst/gstr3b', query: {'period': _period})),
          builder: (ctx, d, _) => Column(children: [
            if (d['note'] != null) InfoBanner('${d['note']}', tone: Tone.warning),
            for (final (code, label, key, showTaxable, strong) in _r3bRows)
              DetailSection('$code — $label', children: [
                if (showTaxable) AmountRow('Taxable value', inr(asJson(d[key])['taxable'])),
                AmountRow('IGST', inr(asJson(d[key])['igst']), bold: strong),
                AmountRow('CGST', inr(asJson(d[key])['cgst']), bold: strong),
                AmountRow('SGST', inr(asJson(d[key])['sgst']), bold: strong),
              ]),
          ]),
        ),
      ]);
}

// ── ITC set-off ──────────────────────────────────────────────────────────────

class _Setoff extends StatefulWidget {
  const _Setoff();

  @override
  State<_Setoff> createState() => _SetoffState();
}

class _SetoffState extends State<_Setoff> {
  String _period = currentPeriod();
  int _tick = 0;
  bool _posting = false;

  bool get _canPost => isFinanceManager && finCanFeature('gst', 'itc_setoff', 'approve');

  Future<void> _post(Json d, double cash) async {
    final ok = await confirmDialog(context,
        title: 'Post GST set-off for $_period?',
        message:
            'This posts a journal on ${fmtDate(d['as_of'])} debiting the output tax ledgers and crediting the input credit ledgers for the ${listOf(d['utilisation']).length} utilisation step(s) shown. The cash portion (${inr(cash)}) must still be paid separately via Payments.',
        confirmLabel: 'Post set-off');
    if (!ok || !mounted) return;
    setState(() => _posting = true);
    try {
      final res = asJson(await Api.post('/accounts/gst/setoff', query: {'period': _period}));
      if (mounted) showSnack(context, 'Set-off for $_period posted as ${res['entry_number']} (${inr(res['amount'])}).');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not post the GST set-off for $_period. ${ApiClient.describe(e)}', error: true);
    } finally {
      if (mounted) {
        setState(() {
          _posting = false;
          _tick++;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const InfoBanner(
            'Input credit is used against output tax in the order CGST Rule 88A sets: IGST credit first (against IGST, then CGST, then SGST); '
            'then CGST credit (CGST, then IGST); then SGST credit (SGST, then IGST). CGST credit never pays SGST and vice versa, and reverse-charge '
            'tax is always paid in cash. Pay the remaining cash portion via Payments → Expense payment, debiting the output tax ledgers.'),
        FinPeriodPicker(period: _period, onChanged: (p) => setState(() => _period = p)),
        ApiLoader<Json>(
          key: ValueKey('$_period$_tick'),
          load: () async => asJson(await Api.get('/accounts/gst/setoff', query: {'period': _period})),
          builder: (ctx, d, _) {
            final b = asJson(d['ledger_balances']);
            final cp = asJson(d['cash_payable']);
            final cf = asJson(d['credit_carried_forward']);
            final cash = toD(cp['igst']) + toD(cp['cgst']) + toD(cp['sgst']) + toD(cp['rcm']);
            final util = listOf(d['utilisation']);
            const heads = ['igst', 'cgst', 'sgst'];
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              padded(_canPost
                  ? actionBtn(
                      _posting ? 'Posting…' : d['already_posted'] == true ? 'Set-off already posted' : 'Post set-off',
                      d['already_posted'] == true || util.isEmpty || _posting ? null : () => _post(d, cash),
                      primary: true)
                  : const Text('Only a Finance Manager can post the set-off.', style: TextStyle(fontSize: 12, color: Brand.muted))),
              if (d['already_posted'] == true)
                InfoBanner('The set-off for ${d['period']} is already posted. Reverse that journal first if you need to redo it.', tone: Tone.success),
              StatGrid([
                StatCard('Cash payable (as of ${fmtDate(d['as_of'])})', inr(cash), tone: cash > 0 ? const Color(0xFFB45309) : null),
                StatCard('Credit carried forward', inr(toD(cf['igst']) + toD(cf['cgst']) + toD(cf['sgst']))),
              ]),
              DetailSection('Ledger balances at period end', children: [
                for (final h in heads) AmountRow('${h.toUpperCase()} — input / output', '${inr(b['${h}_input'])} / ${inr(b['${h}_output'])}'),
                AmountRow('RCM payable', inr(b['rcm_payable'])),
              ]),
              DetailSection('Utilisation (in Rule 88A order)', children: [
                if (util.isEmpty) const Text('Nothing to set off — no input credit and output tax to adjust against each other.', style: TextStyle(color: Brand.muted)),
                for (final (i, s) in util.indexed) AmountRow('${i + 1}. ${s['credit_of']} credit → ${s['paid_against']} liability', inr(s['amount'])),
              ]),
              DetailSection('Cash payable after set-off', children: [
                for (final h in heads) AmountRow(h.toUpperCase(), inr(cp[h])),
                AmountRow('RCM (cash only)', inr(cp['rcm'])),
                AmountRow('Total', inr(cash), bold: true),
              ]),
              DetailSection('Credit carried forward', children: [for (final h in heads) AmountRow(h.toUpperCase(), inr(cf[h]))]),
            ]);
          },
        ),
      ]);
}
