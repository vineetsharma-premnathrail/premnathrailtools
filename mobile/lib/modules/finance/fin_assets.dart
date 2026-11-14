import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';
import 'fin_gst.dart' show FinPeriodPicker;
import 'fin_journals.dart';

/// Finance › Assets (portal finance/assets/page.tsx + AssetAccountingTabs).
class FinAssetsPage extends StatelessWidget {
  const FinAssetsPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Fixed Assets',
        subtitle: 'Asset register, monthly depreciation (Companies Act 2013, Schedule II) and disposals.',
        tabs: [
          FinSubTab('Register', (_) => const _Register(), permTab: 'fixed_assets'),
          FinSubTab('Depreciation', (_) => const _Depreciation(), permTab: 'depreciation'),
          FinSubTab('Capitalisation', (_) => const _Capitalisation(), permTab: 'fixed_assets.capitalisation'),
          FinSubTab('Retirements', (_) => const _Retirements(), permTab: 'fixed_assets.retirements'),
          FinSubTab('Reconciliation', (_) => const _Reconciliation(), permTab: 'fixed_assets.asset_reconciliation'),
          FinSubTab('Tax Depreciation', (_) => const _TaxDep(), permTab: 'tax_depreciation'),
        ],
      );
}

const _statusLabels = {'active': 'Active', 'disposed': 'Disposed', 'posted': 'Posted', 'reversed': 'Reversed'};
const _statusHex = {'active': Color(0xFF15803D), 'disposed': Color(0xFF64748B), 'posted': Color(0xFF15803D), 'reversed': Color(0xFFB91C1C)};
const _green = Color(0xFF15803D);
const _red = Color(0xFFB91C1C);

String _methodLabel(Json a) => a['depreciation_method'] == 'wdv'
    ? 'WDV ${a['wdv_rate_pct'] ?? ''}%'
    : 'SLM ${a['useful_life_months'] != null ? '${a['useful_life_months']} months' : ''}';

Future<List<Option<int>>> _ledgers(String q, bool Function(Json) f) async =>
    (await FinLookups.ledgerOptions(filter: f)).where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase())).toList();

Future<List<Option<int>>> _blocks(String q) async {
  final rows = asRows(await Api.get('/accounts/asset-accounting/it-blocks'));
  return [
    for (final b in rows)
      if (b['is_active'] != false && (q.isEmpty || '${b['code']} ${b['name']}'.toLowerCase().contains(q.toLowerCase())))
        Option(toInt(b['id'])!, '${b['code']} — ${b['name']} (${b['rate_pct']}%)'),
  ];
}

// ── Register ─────────────────────────────────────────────────────────────────

class _Register extends StatefulWidget {
  const _Register();

  @override
  State<_Register> createState() => _RegisterState();
}

class _RegisterState extends State<_Register> {
  final _list = GlobalKey<ApiListViewState>();
  String? _status;

  Future<void> _create() async {
    final code = TextEditingController();
    final name = TextEditingController();
    final location = TextEditingController();
    final desc = TextEditingController();
    int? assetGl, accDepGl, depExpGl, cc;
    String? assetGlL, accDepL, depExpL, ccL;
    DateTime? purchase = DateTime.now();
    DateTime? useDate = DateTime.now();
    final cost = TextEditingController();
    final residual = TextEditingController(text: '0');
    String method = 'slm';
    final life = TextEditingController();
    final wdv = TextEditingController();
    final openingDep = TextEditingController(text: '0');
    final ok = await showFormSheet(
      context,
      title: 'Register a fixed asset',
      saveLabel: 'Register asset',
      builder: (ctx, setS) => [
        const Text('Cost and how it is written off — the purchase itself is booked through a purchase invoice to the asset ledger.',
            style: TextStyle(color: Brand.muted)),
        const Caps('Asset'),
        AppTextField(label: 'Asset code', required: true, controller: code, hint: 'FA-0001'),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'CNC lathe'),
        AppTextField(label: 'Location', controller: location),
        AppTextField(label: 'Description', controller: desc),
        const Caps('Ledgers'),
        AppSelect<int>(
          label: 'Asset cost ledger',
          required: true,
          value: assetGl,
          valueLabel: assetGlL,
          loadOptions: (q) => _ledgers(q, (a) => a['account_type'] == 'asset'),
          onChanged: (o) => setS(() {
            assetGl = o?.value;
            assetGlL = o?.label;
          }),
        ),
        AppSelect<int>(
          label: 'Cost centre',
          value: cc,
          valueLabel: ccL,
          loadOptions: (q) async => (await FinLookups.costCentres()).where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase())).toList(),
          onChanged: (o) => setS(() {
            cc = o?.value;
            ccL = o?.label;
          }),
        ),
        AppSelect<int>(
          label: 'Accumulated depreciation ledger',
          value: accDepGl,
          valueLabel: accDepL ?? 'Default (Ledger Settings)',
          loadOptions: (q) => _ledgers(q, (a) => a['account_type'] == 'asset'),
          onChanged: (o) => setS(() {
            accDepGl = o?.value;
            accDepL = o?.label;
          }),
        ),
        AppSelect<int>(
          label: 'Depreciation expense ledger',
          value: depExpGl,
          valueLabel: depExpL ?? 'Default (Ledger Settings)',
          loadOptions: (q) => _ledgers(q, (a) => a['account_type'] == 'expense'),
          onChanged: (o) => setS(() {
            depExpGl = o?.value;
            depExpL = o?.label;
          }),
        ),
        const Caps('Dates'),
        DateField(label: 'Purchase date', required: true, value: purchase, onChanged: (d) => setS(() => purchase = d)),
        DateField(label: 'Put to use date', required: true, value: useDate, onChanged: (d) => setS(() => useDate = d)),
        const Caps('Cost & depreciation'),
        AppTextField(label: 'Cost (₹)', required: true, controller: cost, keyboardType: AppTextField.number),
        AppTextField(label: 'Residual value (₹)', controller: residual, keyboardType: AppTextField.number),
        AppSelect<String>(
          label: 'Method',
          required: true,
          value: method,
          clearable: false,
          options: const [Option('slm', 'Straight line (SLM)'), Option('wdv', 'Written-down value (WDV)')],
          onChanged: (o) => setS(() => method = o?.value ?? method),
        ),
        if (method == 'slm')
          AppTextField(label: 'Useful life (months)', required: true, controller: life, keyboardType: TextInputType.number)
        else
          AppTextField(label: 'WDV rate (% p.a.)', required: true, controller: wdv, keyboardType: AppTextField.number),
        AppTextField(label: 'Opening accumulated depreciation (₹)', controller: openingDep, keyboardType: AppTextField.number),
        const Text('For an asset brought over from old books — the depreciation charged so far.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        Text(
            '${method == 'slm' ? 'Schedule II useful life, e.g. plant & machinery 15 yrs = 180, computers 3 yrs = 36, furniture 10 yrs = 120, vehicles 8 yrs = 96.' : 'Annual WDV rate, e.g. 18.10% for plant & machinery over 15 years at 5% residual.'}'
            " Residual value is normally up to 5% of cost under Schedule II. Cost, dates and method can't change once registered, because they drive depreciation already charged.",
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        requireField(code.text, 'Asset code');
        requireField(name.text, 'Name');
        if (assetGl == null) throw 'Pick the asset cost ledger.';
        if (purchase == null || useDate == null) throw 'Enter the purchase date and the put-to-use date.';
        await Api.post('/accounts/fixed-assets', data: {
          'asset_code': code.text.trim(),
          'name': name.text.trim(),
          'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
          'location': location.text.trim().isEmpty ? null : location.text.trim(),
          'asset_gl_account_id': assetGl,
          'accumulated_depreciation_gl_account_id': accDepGl,
          'depreciation_expense_gl_account_id': depExpGl,
          'cost_center_id': cc,
          'purchase_date': apiDate(purchase!),
          'put_to_use_date': apiDate(useDate!),
          'cost': double.tryParse(cost.text) ?? 0,
          'residual_value': double.tryParse(residual.text) ?? 0,
          'depreciation_method': method,
          'useful_life_months': method == 'slm' ? int.tryParse(life.text) : null,
          'wdv_rate_pct': method == 'wdv' ? double.tryParse(wdv.text) : null,
          'opening_accumulated_depreciation': double.tryParse(openingDep.text) ?? 0,
        });
      },
    );
    if (ok) _list.currentState?.reload();
  }

  Future<void> _edit(Json a) async {
    final name = TextEditingController(text: '${a['name'] ?? ''}');
    final desc = TextEditingController(text: '${a['description'] ?? ''}');
    final loc = TextEditingController(text: '${a['location'] ?? ''}');
    int? cc = toInt(a['cost_center_id']);
    String? ccL;
    final ok = await showFormSheet(
      context,
      title: 'Edit ${a['asset_code']}',
      builder: (ctx, setS) => [
        const InfoBanner(
            'Only descriptive fields can change. Cost, dates and method drive depreciation already charged — to correct them, dispose of the asset (or delete it if never depreciated) and register it again.'),
        AppTextField(label: 'Name', required: true, controller: name),
        AppTextField(label: 'Description', controller: desc),
        AppTextField(label: 'Location', controller: loc),
        AppSelect<int>(
          label: 'Cost centre',
          value: cc,
          valueLabel: ccL ?? (cc == null ? null : '#$cc'),
          loadOptions: (q) async => (await FinLookups.costCentres()).where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase())).toList(),
          onChanged: (o) => setS(() {
            cc = o?.value;
            ccL = o?.label;
          }),
        ),
      ],
      onSave: () async {
        requireField(name.text, 'Name');
        await Api.patch('/accounts/fixed-assets/${a['id']}', data: {
          'name': name.text.trim(),
          'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
          'location': loc.text.trim().isEmpty ? null : loc.text.trim(),
          'cost_center_id': cc,
        });
      },
    );
    if (ok) _list.currentState?.reload();
  }

  Future<void> _dispose(Json a) async {
    DateTime date = DateTime.now();
    final proceeds = TextEditingController(text: '0');
    int? gl;
    String? glL;
    final ok = await showFormSheet(
      context,
      title: 'Dispose of ${a['asset_code']}',
      saveLabel: 'Dispose',
      builder: (ctx, setS) {
        final sold = (double.tryParse(proceeds.text) ?? 0) > 0;
        return [
          const InfoBanner(
              'Depreciation is first charged up to the disposal date. Then the cost and all accumulated depreciation are removed, the sale value is debited '
              'to the ledger the money went to, and the difference against book value posts to Profit or Loss on Sale of Fixed Assets.'),
          Text(
              'Cost ${inr(a['cost'])} · accumulated depreciation ${inr(a['accumulated_depreciation'])} · book value ${inr(a['book_value'])}${a['depreciated_up_to'] != null ? ' · depreciated to ${fmtDate(a['depreciated_up_to'])}' : ''}',
              style: const TextStyle(fontSize: 12.5)),
          DateField(label: 'Disposal date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
          AppTextField(label: 'Sale proceeds (₹)', controller: proceeds, keyboardType: AppTextField.number, onChanged: (_) => setS(() {})),
          AppSelect<int>(
            label: sold ? 'Proceeds ledger' : 'Proceeds ledger (only if sold)',
            required: sold,
            value: gl,
            valueLabel: glL,
            loadOptions: (q) => _ledgers(q, (a) => true),
            onChanged: (o) => setS(() {
              gl = o?.value;
              glL = o?.label;
            }),
          ),
        ];
      },
      onSave: () async {
        final p = double.tryParse(proceeds.text) ?? 0;
        if (p > 0 && gl == null) throw 'Pick the ledger the sale money went to (bank, cash or the buyer).';
        await Api.post('/accounts/fixed-assets/${a['id']}/dispose', data: {'disposal_date': apiDate(date), 'proceeds': p, 'proceeds_gl_account_id': gl});
      },
    );
    if (ok) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final canManage = isFinanceManager && finCan('fixed_assets', 'edit');
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCan('fixed_assets', 'create') ? CreateFab(label: 'Register asset', onPressed: _create) : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async => ApiPage(sortByCode(asRows(await Api.get('/accounts/fixed-assets', query: {'status': _status})), 'asset_code')),
        header: ChipRow([
          for (final e in const {'active': 'Active', 'disposed': 'Disposed'}.entries)
            CountChip(e.value, null,
                selected: _status == e.key,
                onTap: () => setState(() {
                      _status = _status == e.key ? null : e.key;
                      _list.currentState?.reload();
                    })),
        ]),
        emptyText: 'No assets in the register — use + Register asset.',
        itemBuilder: (ctx, a, reload) => RecordCard(
          code: '${a['asset_code']}',
          title: '${a['name']}',
          subtitle: [a['location'], a['asset_gl_account_name']].where((x) => x != null).join(' · '),
          trailing: FinStatusPill(a['status'], labels: _statusLabels, colors: _statusHex),
          meta: [
            ('Put to use', fmtDate(a['put_to_use_date'])),
            ('Cost', inr(a['cost'])),
            ('Method', _methodLabel(a)),
            ('Acc. dep.', inr(a['accumulated_depreciation'])),
            ('Book value', inr(a['book_value'])),
            ('Depreciated to', a['depreciated_up_to'] != null ? fmtDate(a['depreciated_up_to']) : 'Not yet'),
            if (a['status'] == 'disposed') ('Disposed', '${fmtDate(a['disposal_date'])} for ${inr(a['disposal_proceeds'])}'),
          ],
          onTap: () => showModalBottomSheet<void>(
            context: ctx,
            builder: (s) => SafeArea(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (finCan('fixed_assets', 'edit'))
                  ListTile(title: const Text('Edit'), onTap: () {
                    Navigator.pop(s);
                    _edit(a);
                  }),
                if (canManage && a['status'] == 'active')
                  ListTile(title: const Text('Dispose'), onTap: () {
                    Navigator.pop(s);
                    _dispose(a);
                  }),
                if (finCan('fixed_assets', 'delete') && a['depreciated_up_to'] == null && a['status'] == 'active')
                  ListTile(
                    title: const Text('Delete', style: TextStyle(color: Brand.danger)),
                    onTap: () async {
                      Navigator.pop(s);
                      final ok = await confirmDialog(context,
                          title: 'Delete this asset?',
                          message: 'Delete ${a['asset_code']}? Only an asset never depreciated can be deleted.',
                          confirmLabel: 'Delete',
                          danger: true);
                      if (ok && context.mounted && await runAction(context, () => Api.delete('/accounts/fixed-assets/${a['id']}'))) reload();
                    },
                  ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

// ── Depreciation ─────────────────────────────────────────────────────────────

class _Depreciation extends StatefulWidget {
  const _Depreciation();

  @override
  State<_Depreciation> createState() => _DepreciationState();
}

class _DepreciationState extends State<_Depreciation> {
  String _period = currentPeriod();
  int _tick = 0;
  bool _busy = false;

  bool get _canManage => isFinanceManager && finCan('depreciation', 'approve');
  bool get _canRequest => finCan('depreciation', 'approve');
  bool get _canReverse => isFinanceManager && finCanFeature('depreciation', 'reversal', 'cancel');

  Future<void> _run(double total) async {
    final ok = await confirmDialog(context,
        title: 'Run depreciation for $_period?',
        message:
            'Posts one journal for ${inr(total)}: Dr Depreciation expense / Cr Accumulated depreciation, for every active asset with a charge due up to month end. It can only be undone by reversing this run (newest first).',
        confirmLabel: 'Run & post');
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = asJson(await Api.post('/accounts/fixed-assets/depreciation/runs', data: {'accounting_period': _period}));
      if (mounted) {
        showSnack(context,
            r['approval_status'] == 'pending' ? '${r['message'] ?? 'Sent for approval.'}' : 'Depreciation for $_period posted — ${inr(r['total_amount'])}.');
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Could not run depreciation for $_period. ${ApiClient.describe(e)}', error: true);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _tick++;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const InfoBanner(
            'Depreciation follows Companies Act Schedule II: charged pro-rata by days from the day after the last charge (or the put-to-use date) to '
            'month end, so a missed month catches up. Runs go in month order and are reversed newest first. The asset purchase itself is booked '
            'via a purchase invoice to the asset ledger; this only writes the cost off.'),
        FinPeriodPicker(period: _period, label: 'Month', onChanged: (p) => setState(() => _period = p)),
        ApprovalPanel(
            key: ValueKey('ap$_period$_tick'),
            entityType: 'accounts_depreciation_run',
            entityId: int.parse(_period.replaceAll('-', '')),
            title: 'Approval — depreciation for $_period',
            onChanged: () => setState(() => _tick++)),
        ApiLoader<List<Json>>(
          key: ValueKey('pv$_period$_tick'),
          load: () async => asRows(await Api.get('/accounts/fixed-assets/depreciation/preview', query: {'period': _period})),
          builder: (ctx, rows, _) {
            final total = rows.fold<double>(0, (s, r) => s + toD(r['amount']));
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              padded(_canManage || _canRequest
                  ? actionBtn(_busy ? 'Posting…' : (_canManage ? 'Run depreciation' : 'Request depreciation run'),
                      _busy || total <= 0 ? null : () => _run(total),
                      primary: true)
                  : const Text('You need the Approve permission on Depreciation to run it.', style: TextStyle(fontSize: 12, color: Brand.muted))),
              SectionTitle('Preview — total ${inr(total)}'),
              if (rows.isEmpty) const EmptyView('No active assets in use by this month end.'),
              for (final r in rows)
                RecordCard(
                  code: '${r['asset_code']}',
                  title: '${r['name']}',
                  meta: [
                    ('From', fmtDate(r['from_date'])),
                    ('To', fmtDate(r['to_date'])),
                    ('Days', '${r['days']}'),
                    ('Depreciation', toD(r['amount']) > 0 ? inr(r['amount']) : '—'),
                    ('Book value now', inr(r['book_value'])),
                  ],
                ),
            ]);
          },
        ),
        const SectionTitle('Runs'),
        ApiLoader<List<Json>>(
          key: ValueKey('runs$_tick'),
          load: () async => asRows(await Api.get('/accounts/fixed-assets/depreciation/runs')),
          builder: (ctx, runs, _) => Column(children: [
            if (runs.isEmpty) const EmptyView('No depreciation run yet.'),
            for (final r in runs)
              RecordCard(
                title: periodLabel('${r['accounting_period']}'),
                trailing: FinStatusPill(r['status'], labels: _statusLabels, colors: _statusHex),
                meta: [
                  ('Run date', fmtDate(r['run_date'])),
                  ('Amount', inr(r['total_amount'])),
                  ('Assets', '${listOf(r['lines']).length}'),
                ],
                onTap: () => openScreen(
                    ctx,
                    SubPage(
                      title: 'Depreciation ${r['accounting_period']}',
                      bottom: _canReverse && r['status'] == 'posted'
                          ? ActionBar([
                              actionBtn('Reverse', () async {
                                final reason = await promptDialog(ctx,
                                    title: 'Reverse depreciation for ${r['accounting_period']}?',
                                    message:
                                        "Posts a reversal journal on the run date and puts each asset's accumulated depreciation back to what it was before this run. Give the reason.",
                                    confirmLabel: 'Reverse');
                                if (reason != null && ctx.mounted &&
                                    await runAction(ctx, () => Api.post('/accounts/fixed-assets/depreciation/runs/${r['id']}/reverse', data: {'reason': reason}),
                                        success: 'Run reversed.')) {
                                  if (ctx.mounted) Navigator.pop(ctx);
                                  setState(() => _tick++);
                                }
                              }, danger: true),
                            ])
                          : null,
                      body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
                        if (r['journal_entry_id'] != null)
                          padded(TextButton(
                              onPressed: () => openScreen(ctx, FinVoucherScreen(entryId: toInt(r['journal_entry_id'])!)),
                              child: const Text('Open journal voucher'))),
                        for (final l in listOf(r['lines']))
                          RecordCard(
                            code: '${l['asset_code'] ?? ''}',
                            title: '${l['asset_name'] ?? ''}',
                            meta: [('Days', '${l['days']}'), ('Book value before', inr(l['book_value_before'])), ('Depreciation', inr(l['amount']))],
                          ),
                      ]),
                    )),
              ),
          ]),
        ),
      ]);
}

// ── Capitalisation ───────────────────────────────────────────────────────────

class _MasterForm {
  final code = TextEditingController();
  final name = TextEditingController();
  DateTime? putToUse;
  String method = 'slm';
  final life = TextEditingController();
  final wdv = TextEditingController();
  final residual = TextEditingController(text: '0');
  final qty = TextEditingController(text: '1');
  int? block;
  String? blockL;
  final location = TextEditingController();

  List<Widget> fields(StateSetter setS) => [
        const Caps('Asset'),
        AppTextField(label: 'Asset code', required: true, controller: code),
        AppTextField(label: 'Name', required: true, controller: name),
        DateField(label: 'Put to use on', required: true, value: putToUse, onChanged: (d) => setS(() => putToUse = d)),
        AppTextField(label: 'Units', controller: qty, keyboardType: AppTextField.number),
        AppTextField(label: 'Location', controller: location),
        const Caps('Depreciation'),
        AppSelect<String>(
          label: 'Method',
          required: true,
          value: method,
          clearable: false,
          options: const [Option('slm', 'Straight line (SLM)'), Option('wdv', 'Written-down value (WDV)')],
          onChanged: (o) => setS(() => method = o?.value ?? method),
        ),
        if (method == 'slm')
          AppTextField(label: 'Useful life (months)', required: true, controller: life, keyboardType: TextInputType.number, hint: 'e.g. 180')
        else
          AppTextField(label: 'WDV rate %', required: true, controller: wdv, keyboardType: AppTextField.number),
        AppTextField(label: 'Residual value (₹)', controller: residual, keyboardType: AppTextField.number),
        AppSelect<int>(
          label: 'Income-tax block',
          value: block,
          valueLabel: blockL ?? 'Not mapped yet',
          loadOptions: _blocks,
          onChanged: (o) => setS(() {
            block = o?.value;
            blockL = o?.label;
          }),
        ),
      ];

  Json payload() => {
        'asset_code': code.text.trim(),
        'name': name.text.trim(),
        'put_to_use_date': dateOrNull(putToUse),
        'location': location.text.trim().isEmpty ? null : location.text.trim(),
        'depreciation_method': method,
        'useful_life_months': method == 'slm' ? int.tryParse(life.text) : null,
        'wdv_rate_pct': method == 'wdv' ? double.tryParse(wdv.text) : null,
        'residual_value': double.tryParse(residual.text) ?? 0,
        'quantity': double.tryParse(qty.text) ?? 1,
        'it_block_id': block,
      };
}

bool _isAssetLedger(Json a) =>
    a['account_type'] == 'asset' &&
    RegExp('fixed|plant|property|machinery|furniture|vehicle|equipment|building|computer', caseSensitive: false)
        .hasMatch('${a['group_name'] ?? ''} ${a['name']}');

class _Capitalisation extends StatefulWidget {
  const _Capitalisation();

  @override
  State<_Capitalisation> createState() => _CapitalisationState();
}

class _CapitalisationState extends State<_Capitalisation> {
  int _tick = 0;

  bool get _canManage => finCanFeature('fixed_assets', 'capitalisation', 'create');

  Future<void> _line(Json l) async {
    final f = _MasterForm()
      ..name.text = '${l['description'] ?? ''}'
      ..putToUse = isoToDate(l['invoice_date']);
    final cost = TextEditingController(text: '${l['remaining']}');
    int? gl;
    String? glL;
    Json? a;
    final ok = await showFormSheet(
      context,
      title: 'Capitalise ${l['invoice_number']}',
      saveLabel: 'Register asset',
      builder: (ctx, setS) => [
        Text('${l['description']}', style: const TextStyle(color: Brand.muted)),
        ...f.fields(setS),
        const Caps('Cost'),
        AppTextField(label: 'Cost to register (₹)', required: true, controller: cost, keyboardType: AppTextField.number),
        if (l['on_asset_ledger'] != true) ...[
          AppSelect<int>(
            label: 'Move to fixed-asset ledger',
            required: true,
            value: gl,
            valueLabel: glL,
            loadOptions: (q) => _ledgers(q, _isAssetLedger),
            onChanged: (o) => setS(() {
              gl = o?.value;
              glL = o?.label;
            }),
          ),
          const Text('The line was booked to a ledger that is not a fixed-asset ledger; it is reclassified on capitalisation.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ],
      ],
      onSave: () async {
        if (l['on_asset_ledger'] != true && gl == null) throw 'Pick the fixed-asset ledger the line moves to.';
        a = asJson(await Api.post('/accounts/asset-accounting/capitalise/invoice-line', data: {
          ...f.payload(),
          'vendor_invoice_line_id': l['vendor_invoice_line_id'],
          'cost': double.tryParse(cost.text),
          'asset_gl_account_id': l['on_asset_ledger'] != true ? gl : null,
        }));
      },
    );
    if (ok && mounted) {
      showSnack(context, 'Asset ${a?['asset_code']} registered at ${inr(a?['cost'])}.');
      setState(() => _tick++);
    }
  }

  Future<void> _order(Json o) async {
    final f = _MasterForm()
      ..name.text = '${o['name'] ?? ''}'
      ..putToUse = DateTime.now();
    final amount = TextEditingController(text: '${o['spend_to_settle']}');
    DateTime date = DateTime.now();
    int? gl;
    String? glL;
    Json? a;
    final ok = await showFormSheet(
      context,
      title: 'Settle ${o['code']} to a fixed asset',
      saveLabel: 'Settle',
      builder: (ctx, setS) => [
        Text('${o['name']}', style: const TextStyle(color: Brand.muted)),
        ...f.fields(setS),
        const Caps('Settlement'),
        const InfoBanner(
            "Posts Dr the asset ledger and Cr each ledger the order was charged to (in proportion), tagged with the order, so the order's open spend falls by the amount settled."),
        DateField(label: 'Settlement date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
        AppTextField(label: 'Amount to settle (₹)', required: true, controller: amount, keyboardType: AppTextField.number),
        AppSelect<int>(
          label: 'Fixed-asset ledger',
          required: true,
          value: gl,
          valueLabel: glL,
          loadOptions: (q) => _ledgers(q, _isAssetLedger),
          onChanged: (o) => setS(() {
            gl = o?.value;
            glL = o?.label;
          }),
        ),
      ],
      onSave: () async {
        if (gl == null) throw 'Pick the fixed-asset ledger.';
        a = asJson(await Api.post('/accounts/asset-accounting/capitalise/internal-order', data: {
          ...f.payload(),
          'internal_order_id': o['internal_order_id'],
          'settlement_date': apiDate(date),
          'asset_gl_account_id': gl,
          'amount': double.tryParse(amount.text),
        }));
      },
    );
    if (ok && mounted) {
      showSnack(context, 'Order settled — asset ${a?['asset_code']} registered at ${inr(a?['cost'])}.');
      setState(() => _tick++);
    }
  }

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey(_tick),
        load: () async => asJson(await Api.get('/accounts/asset-accounting/capitalisation-queue')),
        builder: (ctx, q, _) {
          final lines = listOf(q['invoice_lines']);
          final orders = listOf(q['capital_orders']);
          final rni = listOf(q['received_not_invoiced']);
          return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            const InfoBanner(
                "A posted purchase invoice line on a fixed-asset ledger (or for an asset-category PO line / Item Master asset) waits here until it is "
                "registered. The asset's cost is taken from the line, so the register always agrees with the ledger. Spend booked to a capital "
                'internal order is settled into an asset with a journal (Dr asset ledger, Cr the ledgers the order was charged to).'),
            SectionTitle('Invoice lines waiting (${lines.length})'),
            if (lines.isEmpty) padded(const Text('Nothing waiting — every asset purchase is in the register.', style: TextStyle(color: Brand.muted))),
            for (final l in lines)
              RecordCard(
                code: '${l['invoice_number']} · ${fmtDate(l['invoice_date'])}',
                title: '${l['description']}',
                subtitle: '${l['vendor_name'] ?? ''} · ${l['gl_account_label'] ?? ''}${l['on_asset_ledger'] != true ? ' (not an asset ledger — reclassified on capitalisation)' : ''}',
                meta: [('Line value', inr(l['line_value'])), ('Capitalised', inr(l['capitalised'])), ('Open', inr(l['remaining']))],
                onTap: _canManage ? () => _line(l) : null,
              ),
            SectionTitle('Capital orders (CWIP) with unsettled spend (${orders.length})'),
            if (orders.isEmpty) padded(const Text('No capital order has unsettled spend.', style: TextStyle(color: Brand.muted))),
            for (final o in orders)
              RecordCard(
                code: '${o['code']}',
                title: '${o['name']}',
                status: o['status'],
                meta: [('Spend to settle', inr(o['spend_to_settle'])), ('Already settled', inr(o['already_settled']))],
                onTap: _canManage ? () => _order(o) : null,
              ),
            if (rni.isNotEmpty) ...[
              const SectionTitle('Asset PO lines received, bill not posted yet'),
              const InfoBanner(
                  "These were received on a GRN (asset item category — no store stock). They can be capitalised once the vendor's bill is booked and posted under Finance › Purchase.",
                  tone: Tone.warning),
              for (final r in rni)
                RecordCard(
                  code: '${r['po_number']}',
                  title: '${r['description']}',
                  subtitle: r['vendor_name'] as String?,
                  meta: [('Qty received, not billed', fmtNumber(r['received_not_invoiced_qty'])), ('Value at PO rate', inr(r['estimated_value']))],
                ),
            ],
            if (_canManage) padded(const Text('Tap a line or order to register it as an asset.', style: TextStyle(fontSize: 12, color: Brand.muted))),
          ]);
        },
      );
}

// ── Retirements ──────────────────────────────────────────────────────────────

class _Retirements extends StatefulWidget {
  const _Retirements();

  @override
  State<_Retirements> createState() => _RetirementsState();
}

class _RetirementsState extends State<_Retirements> {
  int _tick = 0;

  Future<void> _retire() async {
    List<Json> assets;
    try {
      assets = asRows(await Api.get('/accounts/fixed-assets', query: {'status': 'active'}));
    } catch (e) {
      if (mounted) showSnack(context, 'Could not load assets. ${ApiClient.describe(e)}', error: true);
      return;
    }
    int? assetId;
    String type = 'sale';
    String by = 'percent';
    final share = TextEditingController(text: '100');
    DateTime date = DateTime.now();
    final reason = TextEditingController();
    int? customer;
    String? customerL;
    final saleValue = TextEditingController();
    final gst = TextEditingController(text: '18');
    final hsn = TextEditingController();
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'Retire / sell an asset',
      saveLabel: 'Retire',
      builder: (ctx, setS) => [
        const Text('Scrap or sale, full or partial — depreciation is charged to the retirement date first.', style: TextStyle(color: Brand.muted)),
        const Caps('Asset'),
        AppSelect<int>(
          label: 'Asset',
          required: true,
          value: assetId,
          options: [for (final a in assets) Option(toInt(a['id'])!, '${a['asset_code']} — ${a['name']}', subtitle: 'Book value ${inr(a['book_value'])}')],
          onChanged: (o) => setS(() => assetId = o?.value),
        ),
        DateField(label: 'Date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
        AppSelect<String>(
          label: 'Type',
          required: true,
          value: type,
          clearable: false,
          options: const [Option('sale', 'Sale to a customer'), Option('scrap', 'Scrap (no buyer)')],
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        AppSelect<String>(
          label: 'Retire by',
          value: by,
          clearable: false,
          options: const [Option('percent', '% of cost'), Option('quantity', 'Units')],
          onChanged: (o) => setS(() {
            by = o?.value ?? by;
            share.text = by == 'percent' ? '100' : '1';
          }),
        ),
        AppTextField(label: by == 'percent' ? 'Percent' : 'Units', required: true, controller: share, keyboardType: AppTextField.number),
        AppTextField(label: 'Reason', required: true, controller: reason, hint: 'e.g. obsolete, damaged beyond repair, sold'),
        if (type == 'sale') ...[
          const Caps('Sale'),
          AppSelect<int>(
            label: 'Buyer (customer)',
            required: true,
            value: customer,
            valueLabel: customerL,
            loadOptions: customerOptions,
            onChanged: (o) => setS(() {
              customer = o?.value;
              customerL = o?.label;
            }),
          ),
          AppTextField(label: 'Sale value before GST (₹)', required: true, controller: saleValue, keyboardType: AppTextField.number),
          AppTextField(label: 'GST rate %', required: true, controller: gst, keyboardType: AppTextField.number),
          AppTextField(label: 'HSN', controller: hsn),
          const Text(
              'A draft GST tax invoice to the buyer is raised under Finance › Sales; its revenue line clears the Asset Sale Clearing ledger once another finance user posts it.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ] else
          const Text("No buyer and no sale value — the retired share's book value posts as a loss on retirement.", style: TextStyle(fontSize: 12.5)),
      ],
      onSave: () async {
        if (assetId == null) throw 'Pick the asset to retire.';
        requireField(reason.text, 'Reason');
        if (type == 'sale' && customer == null) throw 'Pick the buyer (customer) of the asset.';
        await Api.post('/accounts/asset-accounting/assets/$assetId/retire', data: {
          'retirement_date': apiDate(date),
          'retirement_type': type,
          'reason': reason.text.trim(),
          'retire_percent': by == 'percent' ? double.tryParse(share.text) ?? 0 : null,
          'retire_quantity': by == 'quantity' ? double.tryParse(share.text) ?? 0 : null,
          'sale_value': type == 'sale' ? double.tryParse(saleValue.text) ?? 0 : 0,
          'customer_id': type == 'sale' ? customer : null,
          'gst_rate': type == 'sale' && gst.text.trim().isNotEmpty ? double.tryParse(gst.text) : null,
          'hsn_sac_code': hsn.text.trim().isEmpty ? null : hsn.text.trim(),
        });
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    final canManage = isFinanceManager && finCanFeature('fixed_assets', 'retirements', 'create');
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: canManage ? CreateFab(label: 'Retire / sell an asset', onPressed: _retire) : null,
      body: ApiLoader<List<Json>>(
        key: ValueKey(_tick),
        load: () async => asRows(await Api.get('/accounts/asset-accounting/retirements')),
        builder: (ctx, rows, _) => ListView(padding: const EdgeInsets.only(bottom: 88), children: [
          const InfoBanner(
              'Retire all or part of an asset (by % of cost or by units). Depreciation is charged to the retirement date, the retired share of cost and '
              'accumulated depreciation is removed, and the gain or loss is posted. A sale also raises a draft GST tax invoice to the buyer under '
              'Finance › Sales — its revenue line clears the Asset Sale Clearing ledger once another finance user posts it.'),
          if (rows.isEmpty) const EmptyView('No retirements yet.'),
          for (final r in rows)
            RecordCard(
              code: '${r['asset_code']} · ${fmtDate(r['retirement_date'])}',
              title: '${r['asset_name']}',
              subtitle: r['customer_name'] != null
                  ? '${r['customer_name']} · ${r['ar_status'] == 'pending' ? 'invoice draft — post under Sales' : r['ar_invoice_number'] ?? ''}'
                  : null,
              trailing: StatusBadge(r['retirement_type'] == 'sale' ? 'Sale' : 'Scrap',
                  color: r['retirement_type'] == 'sale' ? const Color(0xFF1D4ED8) : const Color(0xFF64748B)),
              meta: [
                ('Share', r['retire_quantity'] != null ? '${r['retire_quantity']} unit(s)' : '${r['retire_percent']}%'),
                ('Cost retired', inr(r['retired_cost'])),
                ('Dep. retired', inr(r['retired_accumulated_depreciation'])),
                if (toD(r['sale_value']) != 0) ('Sale value', inr(r['sale_value'])),
                ('Gain / (loss)', inr(r['gain_loss'])),
                ('Journal', txt(r['journal_entry_number'])),
              ],
            ),
        ]),
      ),
    );
  }
}

// ── Reconciliation ───────────────────────────────────────────────────────────

class _Reconciliation extends StatefulWidget {
  const _Reconciliation();

  @override
  State<_Reconciliation> createState() => _ReconciliationState();
}

class _ReconciliationState extends State<_Reconciliation> {
  DateTime? _asOf = DateTime.now();

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        padded(DateField(label: 'As of', value: _asOf, onChanged: (d) => setState(() => _asOf = d))),
        const InfoBanner(
            'Register figures are the current register; run it as of today (or after the last posting) for an exact match. A difference explained by purchases waiting to be capitalised clears once they are registered on the Capitalisation tab.'),
        ApiLoader<Json>(
          key: ValueKey(dateOrNull(_asOf)),
          load: () async => asJson(await Api.get('/accounts/asset-accounting/reconciliation', query: {'as_of': dateOrNull(_asOf)})),
          builder: (ctx, d, _) {
            final rows = listOf(d['rows']);
            return Column(children: [
              StatGrid([StatCard('Status', d['is_reconciled'] == true ? 'Reconciled' : 'Differences', tone: d['is_reconciled'] == true ? _green : _red)]),
              if (rows.isEmpty) const EmptyView('No fixed-asset ledger has a balance.'),
              for (final r in rows)
                RecordCard(
                  title: '${r['gl_account_label']}',
                  subtitle: r['kind'] == 'cost' ? 'Cost' : 'Accumulated depreciation',
                  trailing: StatusBadge(r['ok'] == true ? 'OK' : 'Difference', color: r['ok'] == true ? _green : _red),
                  meta: [
                    ('Ledger balance', inr(r['gl_balance'])),
                    ('Register', inr(r['register'])),
                    ('Difference', inr(r['difference'])),
                    ('Awaiting capitalisation', inr(r['awaiting_capitalisation'])),
                    ('Unexplained', inr(r['unexplained'])),
                  ],
                ),
            ]);
          },
        ),
      ]);
}

// ── Tax depreciation ─────────────────────────────────────────────────────────

String _currentFy() {
  final s = fyStart();
  return '${s.year}-${((s.year + 1) % 100).toString().padLeft(2, '0')}';
}

class _TaxDep extends StatefulWidget {
  const _TaxDep();

  @override
  State<_TaxDep> createState() => _TaxDepState();
}

class _TaxDepState extends State<_TaxDep> {
  String _fy = _currentFy();
  final _rate = TextEditingController(text: '25.168');
  int _tick = 0;

  bool get _canEdit => finCan('tax_depreciation', 'edit');

  List<String> get _fys {
    final s = fyStart().year;
    return [for (var y = s; y >= s - 5; y--) '$y-${((y + 1) % 100).toString().padLeft(2, '0')}'];
  }

  Future<void> _opening(Json b) async {
    final v = await promptDialog(context,
        title: 'Opening WDV $_fy — ${b['block_code']}',
        message: "The block's written-down value at the start of the year, as per the last tax audit report (Form 3CD clause 18).",
        label: 'Opening WDV (₹)',
        confirmLabel: 'Save');
    if (v == null || !mounted) return;
    final n = double.tryParse(v);
    if (n == null || n < 0) {
      showSnack(context, 'Opening WDV must be a number of zero or more.', error: true);
      return;
    }
    if (await runAction(context, () => Api.put('/accounts/asset-accounting/it-blocks/${b['block_id']}/opening', data: {'fy_code': _fy, 'opening_wdv': n}),
        success: 'Opening WDV saved.')) {
      setState(() => _tick++);
    }
  }

  Future<void> _map(Json a) async {
    int? block;
    final ok = await showFormSheet(
      context,
      title: 'Map ${a['asset_code']} to a block',
      saveLabel: 'Map',
      builder: (ctx, setS) => [
        Text('${a['name']}', style: const TextStyle(color: Brand.muted)),
        AppSelect<int>(label: 'Income-tax block', required: true, value: block, loadOptions: _blocks, onChanged: (o) => setS(() => block = o?.value)),
      ],
      onSave: () async {
        if (block == null) throw 'Pick the block.';
        await Api.patch('/accounts/asset-accounting/assets/${a['fixed_asset_id']}/tax-block', data: {'it_block_id': block});
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        padded(Row(children: [
          Expanded(
            child: AppSelect<String>(
              label: 'Financial year',
              value: _fy,
              clearable: false,
              options: [for (final f in _fys) Option(f, f)],
              onChanged: (o) => setState(() => _fy = o?.value ?? _fy),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
              child: AppTextField(
                  label: 'Tax rate for deferred tax %', controller: _rate, keyboardType: AppTextField.number, onChanged: (_) => setState(() => _tick++))),
        ])),
        const InfoBanner(
            "Income-tax Act depreciation on each block's written-down value (Sec 32, Rule 5) — report only, nothing is posted. Additions put to use for "
            'less than 180 days in the year get half the rate; sale money of assets in the block is deducted first. Enter each block\'s opening WDV '
            "once (from the last tax audit report); later years carry the closing WDV forward. Additional depreciation (Sec 32(1)(iia)) isn't "
            "computed — it isn't available under Sec 115BAA."),
        ApiLoader<(Json, Json)>(
          key: ValueKey('$_fy$_tick'),
          load: () async {
            final r = double.tryParse(_rate.text);
            return (
              asJson(await Api.get('/accounts/asset-accounting/it-schedule', query: {'fy': _fy})),
              asJson(await Api.get('/accounts/asset-accounting/deferred-tax', query: {'fy': _fy, 'tax_rate_pct': r})),
            );
          },
          builder: (ctx, data, _) {
            final (s, dt) = data;
            final t = asJson(s['totals']);
            final net = toD(dt['net_deferred_tax']);
            final mv = toD(dt['movement']);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final b in listOf(s['blocks']))
                RecordCard(
                  code: '${b['block_code']} · ${b['rate_pct']}%',
                  title: '${b['block_name']}',
                  meta: [
                    ('Opening WDV', '${inr(b['opening_wdv'])}${b['opening_entered'] == true ? ' (entered)' : ''}'),
                    ('Additions ≥180 d', inr(b['additions_full_rate'])),
                    ('Additions <180 d', inr(b['additions_half_rate'])),
                    ('Sales', inr(b['deductions'])),
                    ('Depreciation', inr(b['depreciation'])),
                    ('Closing WDV', inr(b['closing_wdv'])),
                    if (toD(b['short_term_capital_gain']) != 0) ('STCG (s.50)', inr(b['short_term_capital_gain'])),
                    if (toD(b['short_term_capital_loss']) != 0) ('STCL (s.50)', '(${inr(b['short_term_capital_loss'])})'),
                  ],
                  trailing: _canEdit ? TextButton(onPressed: () => _opening(b), child: const Text('Opening WDV')) : null,
                ),
              DetailSection('Total', children: [
                AmountRow('Opening WDV', inr(t['opening_wdv'])),
                AmountRow('Additions ≥180 d', inr(t['additions_full_rate'])),
                AmountRow('Additions <180 d', inr(t['additions_half_rate'])),
                AmountRow('Sales', inr(t['deductions'])),
                AmountRow('Depreciation', inr(t['depreciation']), bold: true),
                AmountRow('Closing WDV', inr(t['closing_wdv']), bold: true),
              ]),
              if (listOf(s['unmapped_assets']).isNotEmpty) ...[
                const SectionTitle('Assets without an Income-tax block'),
                const InfoBanner('These are left out of the tax schedule and the deferred tax until they are mapped.', tone: Tone.warning),
                for (final a in listOf(s['unmapped_assets']))
                  RecordCard(code: '${a['asset_code']}', title: '${a['name']}', onTap: _canEdit ? () => _map(a) : null),
              ],
              SectionTitle('Deferred tax on fixed assets — ${dt['fy_code']} (as of ${fmtDate(dt['as_of'])})'),
              StatGrid([
                StatCard('Book WDV (Schedule II)', inr(dt['total_book_wdv'])),
                StatCard('Tax WDV', inr(dt['total_tax_wdv'])),
                StatCard(net >= 0 ? 'Net deferred tax liability' : 'Net deferred tax asset', inr(net.abs())),
                StatCard('Charge / (credit) vs ${dt['previous_fy_code']}', mv >= 0 ? inr(mv) : '(${inr(-mv)})'),
              ]),
              for (final r in listOf(dt['rows']))
                RecordCard(
                  title: '${r['block_code'] ?? ''} ${r['block_name'] ?? ''}',
                  meta: [
                    ('Book WDV', inr(r['book_wdv'])),
                    ('Tax WDV', inr(r['tax_wdv'])),
                    ('Timing difference', inr(r['timing_difference'])),
                    ('Deferred tax @ ${dt['tax_rate_pct']}%', inr(r['deferred_tax'])),
                  ],
                ),
              if (toD(dt['unmapped_book_value']) > 0)
                InfoBanner('Book value of ${inr(dt['unmapped_book_value'])} sits on assets not mapped to a block — it is not in the deferred tax above.',
                    tone: Tone.warning),
              const InfoBanner(
                  "A deferred tax asset is recognised only with reasonable certainty of future taxable income (AS 22 para 17). Post the year's charge with a journal at year end."),
            ]);
          },
        ),
      ]);
}
