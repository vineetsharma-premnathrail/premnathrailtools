import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';
import 'fin_gst.dart' show FinPeriodPicker;

/// Finance › Currencies & FX (portal finance/currencies/page.tsx).
class FinCurrenciesPage extends StatelessWidget {
  const FinCurrenciesPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Currencies & FX',
        subtitle: 'Currency master, exchange rates by date, and the month-end revaluation of open foreign-currency bills (books are kept in INR).',
        tabs: [
          FinSubTab('Currencies & Rates', (_) => const _Rates(), permTab: 'currencies'),
          FinSubTab('Revaluation', (_) => const _Revaluation(), permTab: 'currencies'),
        ],
      );
}

const _fx = '/accounts/fx';
const _green = Color(0xFF15803D);
const _red = Color(0xFFB91C1C);

class _Rates extends StatefulWidget {
  const _Rates();

  @override
  State<_Rates> createState() => _RatesState();
}

class _RatesState extends State<_Rates> {
  int _tick = 0;

  Future<void> _addCurrency() async {
    final code = TextEditingController();
    final name = TextEditingController();
    final symbol = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Add currency',
      saveLabel: 'Add currency',
      builder: (ctx, setS) => [
        const Text('A foreign currency used on bills, invoices or vouchers (books stay in INR).', style: TextStyle(color: Brand.muted)),
        AppTextField(label: 'Code', required: true, controller: code, hint: 'USD'),
        const Text('ISO, 3 letters', style: TextStyle(fontSize: 12, color: Brand.muted)),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'US Dollar'),
        AppTextField(label: 'Symbol', controller: symbol, hint: r'$'),
      ],
      onSave: () async {
        if (code.text.trim().length != 3) throw 'Enter the 3-letter ISO code of the currency (e.g. USD).';
        requireField(name.text, 'Name');
        await Api.post('$_fx/currencies', data: {
          'code': code.text.trim().toUpperCase(),
          'name': name.text.trim(),
          'symbol': symbol.text.trim().isEmpty ? null : symbol.text.trim(),
        });
      },
    );
    if (ok) setState(() => _tick++);
  }

  Future<void> _addRate(List<Json> currencies) async {
    String? cur = currencies.where((c) => c['is_active'] != false).map((c) => '${c['code']}').firstOrNull;
    DateTime date = DateTime.now();
    final rate = TextEditingController();
    String type = 'bank';
    final source = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Add exchange rate',
      saveLabel: 'Add rate',
      builder: (ctx, setS) => [
        const Text('INR for 1 unit of the currency, in force from its date until the next one.', style: TextStyle(color: Brand.muted)),
        AppSelect<String>(
          label: 'Currency',
          required: true,
          value: cur,
          options: [for (final c in currencies) if (c['is_active'] != false) Option('${c['code']}', '${c['code']} — ${c['name']}')],
          onChanged: (o) => setS(() => cur = o?.value),
        ),
        DateField(label: 'Date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
        AppTextField(label: 'Rate (₹)', required: true, controller: rate, keyboardType: AppTextField.number),
        AppSelect<String>(
          label: 'Type',
          value: type,
          clearable: false,
          options: const [Option('bank', 'Bank'), Option('customs', 'Customs')],
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        AppTextField(label: 'Source', controller: source, hint: 'e.g. HDFC TT selling'),
      ],
      onSave: () async {
        if (cur == null) throw 'Pick the currency.';
        final r = double.tryParse(rate.text);
        if (r == null || r <= 0) throw 'Enter the rate — INR for 1 unit, more than zero.';
        await Api.post('$_fx/rates', data: {
          'currency': cur,
          'rate_date': apiDate(date),
          'rate': r,
          'rate_type': type,
          'source': source.text.trim().isEmpty ? null : source.text.trim(),
        });
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = finCan('currencies', 'create');
    final canAddRate = finCanFeature('currencies', 'exchange_rates', 'create');
    final canEdit = finCan('currencies', 'edit');
    return ApiLoader<(List<Json>, List<Json>)>(
      key: ValueKey(_tick),
      load: () async => (asRows(await Api.get('$_fx/currencies')), asRows(await Api.get('$_fx/rates'))),
      builder: (ctx, data, _) {
        final (currencies, rates) = data;
        return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          const InfoBanner(
              'A rate is INR for 1 unit of the currency, in force from its date until the next one. Bills, invoices and vouchers in a foreign currency use the '
              'bank rate on their date unless a rate is typed on the document; use the customs rate (CBIC notification) for imports / exports where needed.'),
          SectionTitle('Currencies (${currencies.length})',
              action: canCreate ? TextButton(onPressed: _addCurrency, child: const Text('+ Add currency')) : null),
          if (currencies.isEmpty) padded(const Text('No foreign currency yet — use + Add currency.', style: TextStyle(color: Brand.muted))),
          for (final c in sortByCode(currencies, 'code'))
            RecordCard(
              code: '${c['code']} ${c['symbol'] ?? ''}',
              title: '${c['name']}${c['is_active'] == false ? ' (inactive)' : ''}',
              meta: [('Latest bank rate', '${c['latest_rate'] ?? '—'}'), ('From', fmtDate(c['latest_rate_date']))],
              trailing: canEdit
                  ? TextButton(
                      onPressed: () async {
                        if (await runAction(context, () => Api.patch('$_fx/currencies/${c['id']}', data: {'is_active': c['is_active'] == false}))) {
                          setState(() => _tick++);
                        }
                      },
                      child: Text(c['is_active'] == false ? 'Activate' : 'Deactivate'))
                  : null,
            ),
          SectionTitle('Rates (${rates.length})',
              action: canAddRate ? TextButton(onPressed: () => _addRate(currencies), child: const Text('+ Add rate')) : null),
          if (rates.isEmpty) padded(const Text('No rates entered yet.', style: TextStyle(color: Brand.muted))),
          for (final r in rates)
            RecordCard(
              title: '${r['currency']} · ₹${r['rate']}',
              subtitle: '${r['source'] ?? '—'}',
              meta: [('Date', fmtDate(r['rate_date'])), ('Type', '${r['rate_type']}')],
            ),
        ]);
      },
    );
  }
}

class _Revaluation extends StatefulWidget {
  const _Revaluation();

  @override
  State<_Revaluation> createState() => _RevaluationState();
}

class _RevaluationState extends State<_Revaluation> {
  late String _period = () {
    final d = DateTime(DateTime.now().year, DateTime.now().month - 1, 1);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}';
  }();
  int _tick = 0;

  bool get _canRun => isFinanceManager && finCanFeature('currencies', 'revaluation', 'approve');
  bool get _canCancel => isFinanceManager && finCanFeature('currencies', 'revaluation', 'cancel');

  Future<void> _run(Json preview) async {
    final rates = asJson(preview['rates']);
    final ctrls = {for (final k in rates.keys) k: TextEditingController()};
    final ok = await showFormSheet(
      context,
      title: 'Post FX revaluation — $_period',
      saveLabel: 'Post revaluation',
      builder: (ctx, setS) => [
        const Text('Unrealised gain / loss on the month end, reversed automatically on the 1st.', style: TextStyle(color: Brand.muted)),
        const Caps('Closing rates'),
        for (final k in rates.keys) ...[
          AppTextField(label: '$k closing rate', controller: ctrls[k], keyboardType: AppTextField.number, hint: '${rates[k]}'),
          Text('Blank = master rate ${rates[k]}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ],
        const Caps('Preview at master rates'),
        Text(
            '${listOf(preview['items']).length} open document(s) · gain ${inr(preview['total_gain'])} · loss ${inr(preview['total_loss'])}'),
      ],
      onSave: () async {
        final out = <String, double>{};
        for (final k in rates.keys) {
          final t = ctrls[k]!.text.trim();
          if (t.isEmpty) continue;
          final v = double.tryParse(t);
          if (v == null || v <= 0) throw '$k closing rate must be a number above zero — or leave it blank for the master rate.';
          out[k] = v;
        }
        await Api.post('$_fx/revaluations', data: {'accounting_period': _period, 'rates': out});
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const InfoBanner(
            'Open foreign-currency purchase bills and sales invoices are restated at the month-end rate. The unrealised gain / loss is posted on the last '
            'day of the month and reversed automatically on the 1st, so the realised difference is still worked out against the booking rate when the bill '
            'is settled. Advances are not revalued (non-monetary, AS 11).'),
        FinPeriodPicker(period: _period, label: 'Month', onChanged: (p) => setState(() => _period = p)),
        ApiLoader<Json>(
          key: ValueKey('$_period$_tick'),
          load: () async => asJson(await Api.get('$_fx/revaluations/preview', query: {'period': _period})),
          builder: (ctx, p, _) {
            final items = listOf(p['items']);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              StatGrid([
                StatCard('Unrealised gain', inr(p['total_gain']), tone: _green),
                StatCard('Unrealised loss', inr(p['total_loss']), tone: _red),
              ]),
              if (_canRun) padded(actionBtn('Post revaluation…', items.isEmpty ? null : () => _run(p), primary: true)),
              if (items.isEmpty) const EmptyView('No open foreign-currency document at that month end.'),
              for (final i in items)
                RecordCard(
                  code: '${i['doc_type'] == 'vendor_invoice' ? 'Bill' : 'Invoice'} ${i['number']}',
                  title: '${i['party']}',
                  meta: [
                    ('Currency', '${i['currency']}'),
                    ('Open (FC)', fmtNumber(i['open_fc'])),
                    ('Booking rate', '${i['booking_rate']}'),
                    ('Book value', inr(i['book_inr'])),
                    ('Closing rate', '${i['closing_rate']}'),
                    ('Revalued', inr(i['revalued_inr'])),
                    ('Gain / (loss)', inr(i['gain_loss'])),
                  ],
                ),
            ]);
          },
        ),
        const SectionTitle('Posted revaluations'),
        ApiLoader<List<Json>>(
          key: ValueKey('runs$_tick'),
          load: () async => asRows(await Api.get('$_fx/revaluations')),
          builder: (ctx, runs, _) => Column(children: [
            if (runs.isEmpty) const EmptyView('No revaluation posted yet.'),
            for (final r in runs)
              RecordCard(
                code: '${r['journal_entry_number'] ?? ''}',
                title: periodLabel('${r['accounting_period']}'),
                subtitle: r['reversal_reason'] as String?,
                trailing: FinStatusPill(r['status'], labels: const {'posted': 'Posted', 'reversed': 'Cancelled'}, colors: const {'posted': _green, 'reversed': Color(0xFF78716C)}),
                meta: [('Gain', inr(r['total_gain'])), ('Loss', inr(r['total_loss']))],
                onTap: _canCancel && r['status'] == 'posted'
                    ? () async {
                        final reason = await promptDialog(context,
                            title: 'Cancel FX revaluation ${r['accounting_period']}', label: 'Reason', confirmLabel: 'Cancel revaluation');
                        if (reason != null && context.mounted &&
                            await runAction(context, () => Api.post('$_fx/revaluations/${r['id']}/cancel', data: {'reason': reason}),
                                success: 'Revaluation cancelled.')) {
                          setState(() => _tick++);
                        }
                      }
                    : null,
              ),
          ]),
        ),
      ]);
}
