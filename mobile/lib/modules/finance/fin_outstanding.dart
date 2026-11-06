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
import 'fin_payments.dart';

/// Finance › Outstanding (portal finance/outstanding/* with OutstandingSubNav).
class FinOutstandingPage extends StatelessWidget {
  const FinOutstandingPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Outstanding',
        subtitle: 'Party-wise receivables and payables, aged by due date, with open bills, advances and the party ledger statement.',
        tabs: [
          FinSubTab('Receivables & Payables', (_) => const _Outstanding(), permTab: 'outstanding'),
          FinSubTab('Collections & Dunning', (_) => const _Collections(), permTab: 'collections'),
          FinSubTab('Disputes', (_) => const _Disputes(), permTab: 'disputes'),
          FinSubTab('Credit Management', (_) => const _Credit(), permTab: 'credit_management'),
          FinSubTab('MSME Dues', (_) => const _Msme(), visible: finCanFeature('outstanding', 'msme_dues', 'view')),
        ],
      );
}

const _buckets = ['not_due', '1_30', '31_60', '61_90', 'over_90'];
const _bucketLabels = {'not_due': 'Not due', '1_30': '1–30', '31_60': '31–60', '61_90': '61–90', 'over_90': '>90'};
const _bucketHex = {
  'not_due': Color(0xFF22C55E), '1_30': Color(0xFFEAB308), '31_60': Color(0xFFF59E0B), '61_90': Color(0xFFDC2626), 'over_90': Color(0xFF991B1B),
};
const _red = Color(0xFFB91C1C);
const _purple = Color(0xFF7C3AED);
const _amber = Color(0xFFB45309);

// ── Receivables & payables ───────────────────────────────────────────────────

class _Outstanding extends StatefulWidget {
  const _Outstanding();

  @override
  State<_Outstanding> createState() => _OutstandingState();
}

class _OutstandingState extends State<_Outstanding> {
  late String _type = finCanFeature('outstanding', 'receivables', 'view') ? 'customer' : 'vendor';
  DateTime? _asOf;
  String? _filter;

  @override
  Widget build(BuildContext context) {
    final seeAr = finCanFeature('outstanding', 'receivables', 'view');
    final seeAp = finCanFeature('outstanding', 'payables', 'view');
    if (!seeAr && !seeAp) {
      return ListView(children: const [
        SizedBox(height: 12),
        InfoBanner(
            'Your role can open Receivables & Payables but neither the customer nor the vendor view (Finance & Accounting › Receivables & Payables › '
            'Receivables / Payables). Ask an admin to grant one in Organization › Role & Permissions.',
            tone: Tone.warning),
      ]);
    }
    final keyDate = _asOf != null && apiDate(_asOf!).compareTo(todayIso()) < 0;
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      ChipRow([
        if (seeAr)
          CountChip('Receivables (customers)', null,
              selected: _type == 'customer', onTap: () => setState(() {
                    _type = 'customer';
                    _filter = null;
                  })),
        if (seeAp)
          CountChip('Payables (vendors)', null,
              selected: _type == 'vendor', onTap: () => setState(() {
                    _type = 'vendor';
                    _filter = null;
                  })),
      ]),
      padded(DateField(label: 'Key date (as of)', value: _asOf, onChanged: (d) => setState(() => _asOf = d))),
      if (keyDate)
        InfoBanner(
            'Key-date view as of ${fmtDate(_asOf)}: only bills posted by then, at the amount that was still due then '
            '(settlements after the key date are added back), aged against the key date. Clear the date to see today.',
            tone: Tone.warning),
      InfoBanner(
          'Aging is by due date (invoice date + credit days), not invoice date — a bill only becomes overdue after its due date. '
          'Net = outstanding bills − advances / unadjusted ${_type == 'vendor' ? 'debit' : 'credit'} notes, which equals the '
          "party's balance in the ${_type == 'vendor' ? 'Sundry Creditors' : 'Sundry Debtors'} control account."),
      ApiLoader<Json>(
        key: ValueKey('$_type${dateOrNull(_asOf)}'),
        load: () async => asJson(await Api.get('/accounts/outstanding', query: {'party_type': _type, 'as_of': dateOrNull(_asOf)})),
        builder: (ctx, d, _) {
          final all = listOf(d['rows']);
          final rows = _filter == null ? all : all.where((r) => _filter == 'overdue' ? toD(r['overdue']) > 0 : toD(r['advances']) > 0).toList();
          final t = asJson(d['totals']);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            StatGrid([
              StatCard('Total outstanding', inr(t['outstanding'] ?? 0)),
              StatCard('Overdue', inr(t['overdue'] ?? 0),
                  tone: toD(t['overdue']) > 0 ? _red : null,
                  active: _filter == 'overdue',
                  onTap: () => setState(() => _filter = _filter == 'overdue' ? null : 'overdue')),
              StatCard(_type == 'vendor' ? 'Advances paid' : 'Advances received', inr(t['advances'] ?? 0),
                  tone: _amber, active: _filter == 'advances', onTap: () => setState(() => _filter = _filter == 'advances' ? null : 'advances')),
              StatCard('Net', inr(t['net'] ?? 0)),
            ]),
            if (rows.isEmpty)
              EmptyView(_filter != null
                  ? 'No ${_type == 'vendor' ? 'vendor' : 'customer'} matches this card. Tap the highlighted card again to show everyone.'
                  : 'No ${_type == 'vendor' ? 'payables' : 'receivables'} outstanding.'),
            for (final r in rows)
              RecordCard(
                title: '${r['party_name']}',
                subtitle: '${r['open_bills']} open bill(s)',
                meta: [
                  ('Outstanding', inr(r['outstanding'])),
                  for (final b in _buckets)
                    if (toD(r[b]) != 0) (_bucketLabels[b]!, inr(r[b])),
                  if (_type == 'customer' && toD(r['disputed']) != 0) ('Disputed', inr(r['disputed'])),
                  if (toD(r['overdue']) != 0) ('Overdue', inr(r['overdue'])),
                  if (toD(r['advances']) != 0) ('Advances', inr(r['advances'])),
                  ('Net', inr(r['net'])),
                ],
                onTap: () => openScreen(ctx, _PartyScreen(partyType: _type, party: r, asOf: _asOf)),
              ),
            if (all.isNotEmpty)
              DetailSection(_filter != null ? 'Total (all parties)' : 'Total', children: [
                AmountRow('Open bills', '${all.fold<int>(0, (s, r) => s + (toInt(r['open_bills']) ?? 0))}'),
                AmountRow('Outstanding', inr(t['outstanding'] ?? 0), bold: true),
                for (final b in _buckets) AmountRow(_bucketLabels[b]!, inr(t[b] ?? 0)),
                if (_type == 'customer') AmountRow('Disputed', inr(t['disputed'] ?? 0)),
                AmountRow('Overdue', inr(t['overdue'] ?? 0)),
                AmountRow('Advances', inr(t['advances'] ?? 0)),
                AmountRow('Net', inr(t['net'] ?? 0), bold: true),
              ]),
          ]);
        },
      ),
    ]);
  }
}

class _PartyScreen extends StatefulWidget {
  const _PartyScreen({required this.partyType, required this.party, this.asOf});
  final String partyType;
  final Json party;
  final DateTime? asOf;

  @override
  State<_PartyScreen> createState() => _PartyScreenState();
}

class _PartyScreenState extends State<_PartyScreen> {
  int _tick = 0;
  DateTime? _from = fyStart();
  DateTime? _to = DateTime.now();

  String _creditKind(Json c) => switch (c['source_type']) {
        'payment' => 'On-account voucher',
        'advance' => 'Advance (down payment)',
        'journal' => 'Journal (JV) credit',
        _ => widget.partyType == 'vendor' ? 'Debit note' : 'Credit note',
      };

  @override
  Widget build(BuildContext context) {
    final p = widget.party;
    final vendor = widget.partyType == 'vendor';
    final historical = widget.asOf != null && apiDate(widget.asOf!).compareTo(todayIso()) < 0;
    return SubPage(
      title: '${p['party_name']}',
      bottom: finCan('payments', 'create')
          ? ActionBar([
              actionBtn(vendor ? 'Record payment' : 'Record receipt', () async {
                if (await showPaymentVoucherForm(context,
                    paymentType: widget.partyType,
                    vendorId: vendor ? toInt(p['party_id']) : null,
                    customerId: vendor ? null : toInt(p['party_id']),
                    partyLabel: '${p['party_name']}')) {
                  setState(() => _tick++);
                }
              }, primary: true),
            ])
          : null,
      body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
        padded(Text(
            vendor
                ? 'What we owe this vendor: open bills, advances and debit notes not yet set off, and the account statement.'
                : 'What this customer owes us: open invoices, advances and credit notes not yet set off, and the account statement.',
            style: const TextStyle(color: Brand.muted))),
        StatGrid([
          StatCard('Outstanding', inr(p['outstanding'])),
          StatCard('Overdue', inr(p['overdue']), tone: toD(p['overdue']) > 0 ? _red : null),
          StatCard('Advances', inr(p['advances'])),
          StatCard('Net', inr(p['net'])),
        ]),
        ApiLoader<Json>(
          key: ValueKey('ob$_tick'),
          load: () async => asJson(await Api.get('/accounts/outstanding/bills',
              query: {'party_type': widget.partyType, 'party_id': p['party_id'], 'as_of': dateOrNull(widget.asOf)})),
          builder: (ctx, d, _) {
            final docs = listOf(d['documents']);
            final credits = listOf(d['credits']);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const SectionTitle('Open bills'),
              if (docs.isEmpty)
                padded(Text(
                    vendor
                        ? 'No open bills — everything booked for this vendor is paid or set off.'
                        : 'No open invoices — everything billed to this customer is received or set off.',
                    style: const TextStyle(color: Brand.muted))),
              for (final x in docs)
                RecordCard(
                  code: '${x['doc_number']}',
                  title: 'Due ${inr(x['amount_due'])}',
                  trailing: FinStatusPill(x['bucket'], labels: _bucketLabels, colors: _bucketHex),
                  meta: [
                    ('Date', fmtDate(x['doc_date'])),
                    ('Due date', fmtDate(x['due_date'])),
                    if ((toInt(x['days_overdue']) ?? 0) > 0) ('Days overdue', '${x['days_overdue']}'),
                    ('Bill total', inr(x['total'])),
                    if (toD(x['settled']) != 0) ('Settled', inr(x['settled'])),
                    if (toD(x['disputed']) > 0) ('Disputed', inr(x['disputed'])),
                  ],
                ),
              if (credits.isNotEmpty) ...[
                const SectionTitle('Open credits (advances / unadjusted notes)'),
                for (final c in credits)
                  RecordCard(
                    code: '${c['doc_number']}',
                    title: _creditKind(c),
                    meta: [('Date', fmtDate(c['doc_date'])), ('Amount', inr(c['amount'])), ('Available to allocate', inr(c['available']))],
                    trailing: !historical && docs.isNotEmpty && finCanFeature('payments', 'allocation', 'edit')
                        ? TextButton(
                            onPressed: () async {
                              final ok = await showAllocateSheet(ctx,
                                  sourceType: '${c['source_type']}',
                                  sourceId: toInt(c['id'])!,
                                  docNumber: '${c['doc_number']}',
                                  available: toD(c['available']),
                                  partyType: widget.partyType,
                                  partyId: toInt(p['party_id'])!,
                                  partyName: '${p['party_name']}');
                              if (ok) setState(() => _tick++);
                            },
                            child: const Text('Set off'))
                        : null,
                  ),
                padded(const Text(
                    "Set a credit off against this party's open bills with \"Set off\" — advances, notes and JV credits alike — so the open items match the party balance.",
                    style: TextStyle(fontSize: 12, color: Brand.muted))),
              ],
            ]);
          },
        ),
        const SectionTitle('Statement'),
        DateRangeRow(from: _from, to: _to, onChanged: (f, t) => setState(() {
              _from = f;
              _to = t;
            })),
        ApiLoader<Json>(
          key: ValueKey('st${dateOrNull(_from)}${dateOrNull(_to)}$_tick'),
          load: () async => asJson(await Api.get('/accounts/outstanding/statement', query: {
            'party_type': widget.partyType,
            'party_id': p['party_id'],
            'from_date': dateOrNull(_from),
            'to_date': dateOrNull(_to),
          })),
          builder: (ctx, s, _) => FinLedgerStatementView(data: s, emptyText: 'No postings for this party in the range.'),
        ),
      ]),
    );
  }
}

// ── Collections & dunning ────────────────────────────────────────────────────

const _priorityLabels = {'high': 'High', 'medium': 'Medium', 'low': 'Low'};
const _priorityHex = {'high': Color(0xFFDC2626), 'medium': Color(0xFFF59E0B), 'low': Color(0xFF22C55E)};
const _promiseLabels = {'open': 'Open', 'kept': 'Kept', 'broken': 'Broken', 'cancelled': 'Cancelled'};
const _promiseHex = {'open': Color(0xFF2563EB), 'kept': Color(0xFF16A34A), 'broken': Color(0xFFDC2626), 'cancelled': Color(0xFF78716C)};
const _letterLabels = {'issued': 'Issued', 'cancelled': 'Cancelled'};
const _letterHex = {'issued': Color(0xFF0F766E), 'cancelled': Color(0xFF78716C)};
const _noteTypes = {
  'call': 'Phone call', 'email': 'E-mail', 'visit': 'Visit / meeting', 'promise_to_pay': 'Promise to pay', 'reminder_sent': 'Reminder letter sent', 'note': 'Note',
};

class _Collections extends StatefulWidget {
  const _Collections();

  @override
  State<_Collections> createState() => _CollectionsState();
}

class _CollectionsState extends State<_Collections> {
  int _tick = 0;
  bool _highOnly = false;

  bool get _seeDunning => finCanFeature('collections', 'dunning', 'view');

  Future<void> _run() async {
    Json prop;
    try {
      prop = asJson(await Api.get('/accounts/collections/dunning-proposal'));
    } catch (e) {
      if (mounted) showSnack(context, 'Could not build the dunning proposal. ${ApiClient.describe(e)}', error: true);
      return;
    }
    final customers = listOf(prop['customers']);
    final th = (prop['thresholds'] is List ? prop['thresholds'] as List : const []);
    final picked = {for (final c in customers) toInt(c['customer_id'])!};
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'Dunning run — today',
      saveLabel: 'Issue letters',
      builder: (ctx, setS) => [
        const Text("One reminder letter per ticked customer; each invoice's reminder level is raised.", style: TextStyle(color: Brand.muted)),
        Text(
            'Customers with an invoice whose reminder level goes up today'
            '${th.length == 3 ? ' (level 1 after ${th[0]} days overdue, level 2 after ${th[1]}, final notice after ${th[2]})' : ''}.',
            style: const TextStyle(fontSize: 12.5)),
        Caps('Customers to remind — ${picked.length} of ${customers.length} ticked'),
        if (customers.isEmpty) const Text('No reminder is due today.'),
        for (final c in customers)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: picked.contains(toInt(c['customer_id'])),
            onChanged: (v) => setS(() => v == true ? picked.add(toInt(c['customer_id'])!) : picked.remove(toInt(c['customer_id']))),
            title: Text('${c['customer_name']} · level ${c['level']} · ${inr(c['total_overdue'])}'),
            subtitle: Text(listOf(c['items']).map((i) => '${i['invoice_number']} (${i['previous_level']}→${i['level']})').join(', ')),
          ),
      ],
      onSave: () async {
        if (picked.isEmpty) throw 'Tick at least one customer.';
        await Api.post('/accounts/collections/dunning-run', data: {'customer_ids': picked.toList()});
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCanFeature('collections', 'dunning', 'create') ? CreateFab(label: 'Run dunning', onPressed: _run) : null,
      body: ApiLoader<(Json, List<Json>)>(
        key: ValueKey(_tick),
        load: () async => (
          asJson(await Api.get('/accounts/collections/worklist')),
          _seeDunning ? asRows(await Api.get('/accounts/collections/letters')) : <Json>[],
        ),
        builder: (ctx, data, reload) {
          final (w, letters) = data;
          final t = asJson(w['totals']);
          final rows = listOf(w['rows']).where((r) => !_highOnly || r['priority'] == 'high').toList();
          return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            const InfoBanner(
                'Only the undisputed overdue amount is chased here — open disputes (Outstanding › Disputes) are left out of the worklist and of reminder letters. '
                'Reminder levels and the minimum amount are set in Finance › Settings › Collections & dunning.'),
            StatGrid([
              StatCard('Overdue (undisputed)', inr(t['overdue_amount'] ?? 0), tone: toD(t['overdue_amount']) > 0 ? _red : null),
              StatCard('Customers to chase', '${t['customers'] ?? 0}', onTap: () => setState(() => _highOnly = false)),
              StatCard('High priority', '${t['high'] ?? 0}',
                  tone: (toInt(t['high']) ?? 0) > 0 ? _red : null, active: _highOnly, onTap: () => setState(() => _highOnly = !_highOnly)),
              StatCard('Disputed (not chased)', inr(t['disputed'] ?? 0), tone: _purple),
            ]),
            if (rows.isEmpty)
              EmptyView(_highOnly
                  ? 'No high-priority customers right now. Tap High priority again to show everyone.'
                  : 'No customer has an undisputed overdue invoice.'),
            for (final r in rows)
              RecordCard(
                title: '${r['customer_name']}',
                trailing: FinStatusPill(r['priority'], labels: _priorityLabels, colors: _priorityHex),
                meta: [
                  ('Overdue', inr(r['overdue_amount'])),
                  ('Invoices', '${r['invoices']}'),
                  ('Oldest (days)', '${r['max_days_overdue']}'),
                  ('Level', '${r['max_dunning_level'] ?? '—'}'),
                  ('Last contact',
                      r['last_contact_date'] != null ? '${fmtDate(r['last_contact_date'])} · ${_noteTypes['${r['last_contact_type']}'] ?? r['last_contact_type']}' : '—'),
                  ('Promise to pay', r['open_promise_date'] != null ? '${inr(r['open_promise_amount'] ?? 0)} by ${fmtDate(r['open_promise_date'])}' : '—'),
                  ('Next follow-up', fmtDate(r['next_follow_up'])),
                  if ((toInt(r['broken_promises']) ?? 0) > 0) ('Broken promises', '${r['broken_promises']}'),
                ],
                onTap: () async {
                  await Navigator.of(ctx).push(MaterialPageRoute(
                      builder: (_) => _CustomerScreen(customerId: toInt(r['customer_id'])!, customerName: '${r['customer_name']}')));
                  reload();
                },
              ),
            if (_seeDunning) ...[
              const SectionTitle('Reminder letters'),
              _Letters(letters: letters, onChanged: () => setState(() => _tick++)),
            ],
          ]);
        },
      ),
    );
  }
}

class _Letters extends StatelessWidget {
  const _Letters({required this.letters, required this.onChanged});
  final List<Json> letters;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final canCancel = finCanFeature('collections', 'dunning', 'cancel');
    if (letters.isEmpty) return padded(const Text('No reminder letters yet — run dunning to issue them.', style: TextStyle(color: Brand.muted)));
    return Column(children: [
      for (final l in letters)
        RecordCard(
          code: '${l['letter_number']}',
          title: txt(l['customer_name']),
          subtitle: l['status'] == 'cancelled' && l['cancelled_reason'] != null ? 'Cancelled: ${l['cancelled_reason']}' : null,
          trailing: FinStatusPill(l['status'], labels: _letterLabels, colors: _letterHex),
          meta: [
            ('Date', fmtDate(l['letter_date'])),
            ('Level', '${l['dunning_level']}'),
            ('Overdue', inr(l['total_overdue'])),
            ('Invoices', '${listOf(l['items']).length}'),
          ],
          onTap: () => showModalBottomSheet<void>(
            context: context,
            builder: (ctx) => SafeArea(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                ListTile(
                  leading: const Icon(Icons.picture_as_pdf_outlined),
                  title: const Text('Download PDF'),
                  onTap: () {
                    Navigator.pop(ctx);
                    finDownload(context, '/accounts/collections/letters/${l['id']}/letter.pdf', 'Reminder-${l['letter_number']}.pdf'.replaceAll('/', '-'));
                  },
                ),
                if (canCancel && l['status'] == 'issued')
                  ListTile(
                    leading: const Icon(Icons.cancel_outlined, color: Brand.danger),
                    title: const Text('Cancel letter'),
                    onTap: () async {
                      Navigator.pop(ctx);
                      final reason = await promptDialog(context,
                          title: 'Cancel ${l['letter_number']}?',
                          label: 'Reason (e.g. payment received before sending)',
                          confirmLabel: 'Cancel letter');
                      if (reason == null || !context.mounted) return;
                      if (await runAction(context, () => Api.post('/accounts/collections/letters/${l['id']}/cancel', data: {'reason': reason}),
                          success: 'Letter cancelled.')) {
                        onChanged();
                      }
                    },
                  ),
              ]),
            ),
          ),
        ),
    ]);
  }
}

class _CustomerScreen extends StatefulWidget {
  const _CustomerScreen({required this.customerId, required this.customerName});
  final int customerId;
  final String customerName;

  @override
  State<_CustomerScreen> createState() => _CustomerScreenState();
}

class _CustomerScreenState extends State<_CustomerScreen> {
  int _tick = 0;

  Future<void> _log(List<Json> invoices) async {
    String type = 'call';
    DateTime? date = DateTime.now();
    final contact = TextEditingController();
    int? invoiceId;
    final remarks = TextEditingController();
    DateTime? promisedDate;
    final promisedAmount = TextEditingController();
    DateTime? followUp;
    final ok = await showFormSheet(
      context,
      title: 'Log contact',
      builder: (ctx, setS) {
        final promise = type == 'promise_to_pay';
        return [
          Text(widget.customerName, style: const TextStyle(color: Brand.muted)),
          const Caps('Contact'),
          AppSelect<String>(
            label: 'Type',
            required: true,
            value: type,
            clearable: false,
            options: [
              for (final e in _noteTypes.entries)
                if (e.key != 'reminder_sent') Option(e.key, e.value),
            ],
            onChanged: (o) => setS(() => type = o?.value ?? type),
          ),
          DateField(label: 'Date', value: date, onChanged: (d) => setS(() => date = d)),
          AppTextField(label: 'Spoke to', controller: contact, hint: 'Name / designation'),
          AppSelect<int>(
            label: 'Invoice',
            value: invoiceId,
            valueLabel: invoiceId == null ? 'Whole account' : null,
            options: [for (final i in invoices) Option(toInt(i['ar_transaction_id'])!, '${i['invoice_number']} — ${inr(i['undisputed_due'])}')],
            onChanged: (o) => setS(() => invoiceId = o?.value),
          ),
          AppTextField(label: 'What was said', required: true, controller: remarks, maxLines: 4),
          if (promise) ...[
            const Caps('Promise to pay'),
            DateField(label: 'Promised date', required: true, value: promisedDate, onChanged: (d) => setS(() => promisedDate = d)),
            AppTextField(label: 'Promised amount (₹)', required: true, controller: promisedAmount, keyboardType: AppTextField.number),
            const Text('Checked against receipts after its date: kept if the amount came in, otherwise broken (you are reminded).',
                style: TextStyle(fontSize: 12, color: Brand.muted)),
          ],
          const Caps('Follow-up'),
          DateField(label: 'Follow-up date', value: followUp, onChanged: (d) => setS(() => followUp = d)),
          if (promise) const Text('Blank = the promised date.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        ];
      },
      onSave: () async {
        final promise = type == 'promise_to_pay';
        if (remarks.text.trim().isEmpty) throw 'Write what was discussed.';
        if (promise && (promisedDate == null || (double.tryParse(promisedAmount.text) ?? 0) == 0)) {
          throw 'A promise to pay needs the promised date and amount.';
        }
        await Api.post('/accounts/collections/notes', data: {
          'customer_id': widget.customerId,
          'note_type': type,
          'note_date': dateOrNull(date),
          'contact_person': contact.text.trim().isEmpty ? null : contact.text.trim(),
          'remarks': remarks.text.trim(),
          'ar_transaction_id': invoiceId,
          'promised_date': promise ? dateOrNull(promisedDate) : null,
          'promised_amount': promise ? double.tryParse(promisedAmount.text) : null,
          'follow_up_date': dateOrNull(followUp),
        });
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      key: ValueKey(_tick),
      load: () async => asJson(await Api.get('/accounts/collections/customers/${widget.customerId}')),
      builder: (ctx, d, reload) {
        final items = listOf(d['overdue_items']);
        final notes = listOf(d['notes']);
        final letters = listOf(d['letters']);
        return SubPage(
          title: widget.customerName,
          bottom: finCan('collections', 'create')
              ? ActionBar([actionBtn('Log contact / promise', () => _log(items), primary: true)])
              : null,
          body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            const SectionTitle('Overdue invoices'),
            if (items.isEmpty) padded(const Text('Nothing overdue.', style: TextStyle(color: Brand.muted))),
            for (final i in items)
              RecordCard(
                code: '${i['invoice_number']}',
                title: 'To collect ${inr(i['undisputed_due'])}',
                meta: [
                  ('Date', fmtDate(i['invoice_date'])),
                  ('Due', fmtDate(i['due_date'])),
                  ('Days overdue', '${i['days_overdue']}'),
                  ('Due amount', inr(i['amount_due'])),
                  if (toD(i['disputed']) != 0) ('Disputed', inr(i['disputed'])),
                  ('Level', '${i['dunning_level'] ?? '—'}'),
                ],
              ),
            const SectionTitle('Contact log'),
            if (notes.isEmpty) padded(const Text('No contact logged yet.', style: TextStyle(color: Brand.muted))),
            for (final n in notes)
              RecordCard(
                title: '${_noteTypes['${n['note_type']}'] ?? n['note_type']} · ${fmtDate(n['note_date'])}',
                subtitle: '${n['remarks'] ?? ''}${n['invoice_number'] != null ? '\nInvoice ${n['invoice_number']}' : ''}',
                trailing: n['promise_status'] != null ? FinStatusPill(n['promise_status'], labels: _promiseLabels, colors: _promiseHex) : null,
                meta: [
                  if (n['contact_person'] != null) ('Contact', '${n['contact_person']}'),
                  if (n['note_type'] == 'promise_to_pay')
                    ('Promise', '${inr(n['promised_amount'] ?? 0)} by ${fmtDate(n['promised_date'])}${n['promise_received'] != null && n['promise_status'] != 'open' ? ' · received ${inr(n['promise_received'])}' : ''}'),
                  if (n['follow_up_date'] != null) ('Follow-up', fmtDate(n['follow_up_date'])),
                  ('By', txt(n['created_by_name'])),
                ],
                onTap: finCan('collections', 'edit') && n['promise_status'] == 'open'
                    ? () async {
                        final ok = await confirmDialog(context,
                            title: 'Cancel this promise?', message: 'The promise to pay is cancelled; the contact stays in the log.', confirmLabel: 'Cancel promise', danger: true);
                        if (ok && context.mounted) {
                          if (await runAction(context, () => Api.post('/accounts/collections/notes/${n['id']}/cancel-promise'))) reload();
                        }
                      }
                    : null,
              ),
            if (letters.isNotEmpty && finCanFeature('collections', 'dunning', 'view')) ...[
              const SectionTitle('Reminder letters to this customer'),
              _Letters(letters: letters, onChanged: reload),
            ],
          ]),
        );
      },
    );
  }
}

// ── Disputes ─────────────────────────────────────────────────────────────────

const _reasons = {
  'quality': 'Quality claim', 'quantity': 'Quantity / short supply', 'price': 'Price / rate', 'ld': 'LD (liquidated damages)',
  'documentation': 'Documentation', 'other': 'Other',
};
const _dispLabels = {
  'open': 'Open', 'under_review': 'Under review', 'resolved_credit_note': 'Credit note', 'resolved_paid': 'Customer paid', 'written_off': 'Written off',
};
const _dispHex = {
  'open': Color(0xFFDC2626), 'under_review': Color(0xFFF59E0B), 'resolved_credit_note': Color(0xFF16A34A),
  'resolved_paid': Color(0xFF0F766E), 'written_off': Color(0xFF7C3AED),
};

class _Disputes extends StatefulWidget {
  const _Disputes();

  @override
  State<_Disputes> createState() => _DisputesState();
}

class _DisputesState extends State<_Disputes> {
  String _filter = 'Open';
  int _tick = 0;

  Future<void> _new() async {
    List<Json> docs;
    try {
      docs = listOf(asJson(await Api.get('/accounts/outstanding/bills', query: {'party_type': 'customer'}))['documents']);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    int? invoiceId;
    final amount = TextEditingController();
    String reason = 'quality';
    final desc = TextEditingController();
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'Raise dispute',
      saveLabel: 'Raise dispute',
      builder: (ctx, setS) => [
        const Text('A customer claim against a posted sales invoice.', style: TextStyle(color: Brand.muted)),
        AppSelect<int>(
          label: 'Sales invoice',
          required: true,
          value: invoiceId,
          options: [
            for (final d in docs)
              Option(toInt(d['id'])!, '${d['doc_number']} — ${d['party_name'] ?? ''}', subtitle: '${inr(d['amount_due'])} due'),
          ],
          onChanged: (o) => setS(() => invoiceId = o?.value),
        ),
        AppTextField(label: 'Disputed amount (₹)', required: true, controller: amount, keyboardType: AppTextField.number),
        AppSelect<String>(
          label: 'Reason',
          required: true,
          value: reason,
          clearable: false,
          options: [for (final e in _reasons.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => reason = o?.value ?? reason),
        ),
        AppTextField(label: 'What does the customer dispute?', required: true, controller: desc, maxLines: 4),
      ],
      onSave: () async {
        if (invoiceId == null) throw 'Pick the sales invoice the customer disputes.';
        final a = double.tryParse(amount.text) ?? 0;
        if (a <= 0) throw 'Enter the disputed amount — a number greater than zero.';
        requireField(desc.text, 'What does the customer dispute?');
        await Api.post('/accounts/disputes', data: {'ar_transaction_id': invoiceId, 'disputed_amount': a, 'reason': reason, 'description': desc.text.trim()});
      },
    );
    if (ok) setState(() => _tick++);
  }

  Future<void> _resolve(Json d) async {
    List<Json> notes = [];
    try {
      notes = asRows(await Api.get('/accounts/notes', query: {'note_type': 'credit_note', 'customer_id': d['customer_id']}));
    } catch (_) {}
    String resolution = 'credit_note';
    int? noteId;
    final note = TextEditingController();
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'Resolve ${d['dispute_number']}',
      saveLabel: 'Resolve',
      builder: (ctx, setS) => [
        Text('${inr(d['disputed_amount'])} disputed on ${d['invoice_number']}', style: const TextStyle(color: Brand.muted)),
        AppSelect<String>(
          label: 'Resolution',
          required: true,
          value: resolution,
          clearable: false,
          options: const [
            Option('credit_note', 'Credit note given (GST reversed by the note)'),
            Option('write_off', 'Write off the disputed amount (no GST change)'),
            Option('paid', 'Claim withdrawn — customer pays in full'),
          ],
          onChanged: (o) => setS(() => resolution = o?.value ?? resolution),
        ),
        if (resolution == 'credit_note')
          AppSelect<int>(
            label: 'Credit note against this invoice',
            value: noteId,
            valueLabel: notes.isEmpty ? 'None yet — raise it in Finance › Sales › Credit Notes first' : null,
            options: [for (final n in notes) Option(toInt(n['id'])!, '${n['note_number']} — ${inr(n['total_amount'])} (${n['status']})')],
            onChanged: (o) => setS(() => noteId = o?.value),
          ),
        if (resolution == 'write_off')
          const Text(
              'Posts Dr deduction ledger / Cr Debtors for the disputed amount (up to what is still due). Above the small-difference tolerance in Finance › Settings only a Finance Manager can do this. '
              'A reduction of the taxable value (price/rate) should go by credit note instead, so GST is reversed.',
              style: TextStyle(fontSize: 12.5)),
        AppTextField(label: 'Resolution note', required: true, controller: note, maxLines: 3),
      ],
      onSave: () async {
        requireField(note.text, 'Resolution note');
        await Api.post('/accounts/disputes/${d['id']}/resolve', data: {
          'resolution': resolution,
          'note': note.text.trim(),
          if (resolution == 'credit_note' && noteId != null) 'party_note_id': noteId,
        });
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = finCan('disputes', 'edit');
    final canResolve = finCanFeature('disputes', 'resolution', 'approve');
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCan('disputes', 'create') ? CreateFab(label: 'Raise dispute', onPressed: _new) : null,
      body: ApiLoader<List<Json>>(
        key: ValueKey('$_filter$_tick'),
        load: () async => asRows(await Api.get('/accounts/disputes', query: _filter == 'Open' ? {'status': 'open_all'} : null)),
        builder: (ctx, all, _) {
          final rows = _filter == 'Resolved' ? all.where((r) => !const ['open', 'under_review'].contains(r['status'])).toList() : all;
          final open = all.where((r) => const ['open', 'under_review'].contains(r['status'])).toList();
          return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            const InfoBanner(
                'While a dispute is open its amount is shown in the Disputed column of aging, is not chased in Collections and does not put the customer on credit hold. '
                'Resolve it with a credit note (Finance › Sales › Credit Notes, against the same invoice), a write-off, or mark it paid when the customer withdraws the claim.'),
            StatGrid([
              StatCard('Open disputes', '${open.length}', active: _filter == 'Open', onTap: () => setState(() => _filter = _filter == 'Open' ? 'All' : 'Open')),
              StatCard('Disputed amount (open)', inr(open.fold<double>(0, (s, r) => s + toD(r['disputed_amount']))), tone: _purple),
            ]),
            ChipRow([
              for (final f in const ['Open', 'Resolved', 'All']) CountChip(f, null, selected: _filter == f, onTap: () => setState(() => _filter = f)),
            ]),
            if (rows.isEmpty) const EmptyView('No disputes — use Raise dispute when a customer contests an invoice.'),
            for (final d in rows)
              RecordCard(
                code: '${d['dispute_number']} · ${fmtDate(d['raised_on'])}',
                title: '${d['customer_name']}',
                subtitle: '${d['description'] ?? ''}'
                    '${d['resolution_note'] != null ? '\nResolution (${d['resolved_by_name']}, ${fmtDate(d['resolved_on'])}): ${d['resolution_note']}${d['credit_note_number'] != null ? ' — ${d['credit_note_number']}' : ''}' : ''}',
                trailing: FinStatusPill(d['status'], labels: _dispLabels, colors: _dispHex),
                meta: [
                  ('Invoice', '${d['invoice_number']}'),
                  ('Disputed', inr(d['disputed_amount'])),
                  ('Invoice due', inr(d['invoice_due'] ?? 0)),
                  ('Reason', _reasons['${d['reason']}'] ?? '${d['reason']}'),
                  ('Owner', txt(d['owner_name'])),
                ],
                onTap: (canEdit && d['status'] == 'open') || (canResolve && const ['open', 'under_review'].contains(d['status']))
                    ? () => showModalBottomSheet<void>(
                          context: ctx,
                          builder: (s) => SafeArea(
                            child: Column(mainAxisSize: MainAxisSize.min, children: [
                              if (canEdit && d['status'] == 'open')
                                ListTile(
                                  title: const Text('Under review'),
                                  onTap: () async {
                                    Navigator.pop(s);
                                    if (await runAction(context, () => Api.patch('/accounts/disputes/${d['id']}', data: {'status': 'under_review'}))) {
                                      setState(() => _tick++);
                                    }
                                  },
                                ),
                              if (canResolve && const ['open', 'under_review'].contains(d['status']))
                                ListTile(
                                  title: const Text('Resolve'),
                                  onTap: () {
                                    Navigator.pop(s);
                                    _resolve(d);
                                  },
                                ),
                            ]),
                          ),
                        )
                    : null,
              ),
          ]);
        },
      ),
    );
  }
}

// ── Credit management ────────────────────────────────────────────────────────

const _relLabels = {'pending_approval': 'Waiting approval', 'released': 'Released', 'rejected': 'Rejected', 'withdrawn': 'Withdrawn'};
const _relHex = {'pending_approval': Color(0xFFF59E0B), 'released': Color(0xFF16A34A), 'rejected': Color(0xFFDC2626), 'withdrawn': Color(0xFF78716C)};
const _cpLabels = {'so_confirmation': 'SO confirmation', 'dispatch': 'Dispatch'};

class _Credit extends StatefulWidget {
  const _Credit();

  @override
  State<_Credit> createState() => _CreditState();
}

class _CreditState extends State<_Credit> {
  int _tick = 0;
  bool _holdOnly = false;
  bool _pendingOnly = false;

  Future<void> _request(Json pos) async {
    String checkpoint = 'dispatch';
    final reason = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Request credit release',
      saveLabel: 'Request release',
      builder: (ctx, setS) => [
        Text('${pos['customer_name']}', style: const TextStyle(color: Brand.muted)),
        const Caps('Why it is blocked'),
        for (final r in (pos['block_reasons'] is List ? pos['block_reasons'] as List : const []))
          Text('• $r', style: const TextStyle(color: _red)),
        const Caps('Release request'),
        AppSelect<String>(
          label: 'For',
          required: true,
          value: checkpoint,
          clearable: false,
          options: [for (final e in _cpLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => checkpoint = o?.value ?? checkpoint),
        ),
        const Text('Order: any order of this customer.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        AppTextField(label: 'Why should it go ahead?', required: true, controller: reason, maxLines: 3),
      ],
      onSave: () async {
        if (reason.text.trim().isEmpty) throw 'Say why the order / dispatch should go ahead despite the credit block.';
        await Api.post('/accounts/credit/releases',
            data: {'customer_id': pos['customer_id'], 'checkpoint': checkpoint, 'reason': reason.text.trim()});
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<(List<Json>, List<Json>)>(
      key: ValueKey(_tick),
      load: () async => (asRows(await Api.get('/accounts/credit/overview')), asRows(await Api.get('/accounts/credit/releases'))),
      builder: (ctx, data, _) {
        final (all, releases) = data;
        final rows = _holdOnly ? all.where((r) => r['would_block'] == true).toList() : all;
        final rels = _pendingOnly ? releases.where((r) => r['status'] == 'pending_approval').toList() : releases;
        final blocked = all.where((r) => r['would_block'] == true).length;
        final pending = releases.where((r) => r['status'] == 'pending_approval').length;
        return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          const InfoBanner(
              'Credit exposure = open invoices + delivered-not-billed + open order value − unapplied receipts, against the CRM credit limit. '
              'Over the limit, or an invoice overdue beyond its credit days, puts SO confirmation and dispatch on hold until a release is approved.'),
          StatGrid([
            StatCard('Customers on hold', '$blocked', tone: blocked > 0 ? _red : null, active: _holdOnly, onTap: () => setState(() => _holdOnly = !_holdOnly)),
            StatCard('Releases waiting', '$pending', tone: pending > 0 ? _amber : null, active: _pendingOnly, onTap: () => setState(() => _pendingOnly = !_pendingOnly)),
            StatCard('Total exposure', inr(all.fold<double>(0, (s, r) => s + toD(r['exposure'])))),
          ]),
          if (rows.isEmpty)
            EmptyView(_holdOnly
                ? 'No customer is on hold. Tap Customers on hold again to show everyone.'
                : 'No customer has a credit limit, open invoices or open orders.'),
          for (final r in rows)
            RecordCard(
              title: '${r['customer_name']}',
              subtitle: r['would_block'] == true ? (r['block_reasons'] is List ? (r['block_reasons'] as List).join('; ') : null) : null,
              trailing: StatusBadge(r['would_block'] == true ? 'On hold' : 'Within credit',
                  color: r['would_block'] == true ? const Color(0xFFDC2626) : const Color(0xFF16A34A)),
              meta: [
                ('Limit', r['credit_limit'] != null ? inr(r['credit_limit']) : '—'),
                ('Open invoices', inr(r['open_ar'])),
                ('Delivered, not billed', inr(r['unbilled_delivered'])),
                ('Open orders', inr(r['open_order_value'])),
                ('Unapplied', inr(r['unapplied_credits'])),
                ('Exposure', inr(r['exposure'])),
                ('Available', r['available'] != null ? inr(r['available']) : '—'),
                ('Overdue', '${inr(r['overdue_amount'])}${(toInt(r['max_days_overdue']) ?? 0) > 0 ? ' · ${r['max_days_overdue']} d' : ''}'),
              ],
              onTap: r['would_block'] == true ? () => _request(r) : null,
            ),
          const SectionTitle('Credit releases'),
          if (rels.isEmpty)
            padded(Text(
                _pendingOnly ? 'No release is waiting for approval. Tap Releases waiting again to show all.' : 'No credit release requested yet.',
                style: const TextStyle(color: Brand.muted))),
          for (final r in rels)
            RecordCard(
              code: '${r['release_number']} · ${r['requested_by_name'] ?? ''}',
              title: '${r['customer_name']}',
              subtitle: '${r['request_reason'] ?? ''}${r['decision_comment'] != null ? '\nDecision: ${r['decision_comment']}' : ''}',
              trailing: Padding(
                padding: const EdgeInsets.only(left: 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  FinStatusPill(r['status'], labels: _relLabels, colors: _relHex),
                  if (r['status'] == 'pending_approval') ApprovalBadge(status: r['approval_status'] as String?, stage: r['approval_stage'] as String?),
                ]),
              ),
              meta: [
                ('For', _cpLabels['${r['checkpoint']}'] ?? '${r['checkpoint']}'),
                ('Order', '${r['so_number'] ?? 'Any order'}'),
                ('Why blocked', txt(r['block_reasons'])),
                ('Valid until', fmtDate(r['valid_until'])),
              ],
              onTap: r['status'] == 'pending_approval' && toInt(r['requested_by_id']) == Perm.userId
                  ? () async {
                      final ok = await confirmDialog(context,
                          title: 'Withdraw this release request?', message: 'The approvers will no longer see it.', confirmLabel: 'Withdraw');
                      if (ok && context.mounted) {
                        if (await runAction(context, () => Api.post('/accounts/credit/releases/${r['id']}/withdraw', data: {}), success: 'Release withdrawn.')) {
                          setState(() => _tick++);
                        }
                      }
                    }
                  : null,
            ),
          if (finCan('credit_management', 'approve'))
            padded(const Text('Approve or reject pending releases from your Approvals inbox (Organization › Approvals).',
                style: TextStyle(fontSize: 12, color: Brand.muted))),
        ]);
      },
    );
  }
}

// ── MSME dues ────────────────────────────────────────────────────────────────

const _msmeLabels = {'breached': 'Past 45-day limit', 'due_soon': 'Due soon', 'ok': 'Within limit'};
const _msmeHex = {'breached': Color(0xFFDC2626), 'due_soon': Color(0xFFF59E0B), 'ok': Color(0xFF16A34A)};

class _Msme extends StatefulWidget {
  const _Msme();

  @override
  State<_Msme> createState() => _MsmeState();
}

class _MsmeState extends State<_Msme> {
  String? _filter;
  late int _fy = fyStart().year - 1;

  @override
  Widget build(BuildContext context) {
    final years = [for (var y = 2023; y <= fyStart().year; y++) y];
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      const InfoBanner(
          'Micro, small and medium suppliers (Udyam) must be paid within the agreed days — at most 45 days from acceptance, 15 if nothing is agreed. '
          'Set the MSME category on the vendor in Procurement › Vendors.'),
      ApiLoader<Json>(
        load: () async => asJson(await Api.get('/accounts/msme/alerts')),
        builder: (ctx, a, _) {
          final rows = listOf(a['rows']).where((r) => _filter == null || r['status'] == _filter).toList();
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            StatGrid([
              StatCard('Bills past the limit', '${a['breached_count']}',
                  tone: const Color(0xFFDC2626), active: _filter == 'breached', onTap: () => setState(() => _filter = _filter == 'breached' ? null : 'breached')),
              StatCard('Amount past the limit', inr(a['breached_amount']),
                  tone: const Color(0xFFDC2626), active: _filter == 'breached', onTap: () => setState(() => _filter = _filter == 'breached' ? null : 'breached')),
              StatCard('Due within 7 days', '${a['due_soon_count']}',
                  tone: const Color(0xFFF59E0B), active: _filter == 'due_soon', onTap: () => setState(() => _filter = _filter == 'due_soon' ? null : 'due_soon')),
            ]),
            if (rows.isEmpty)
              EmptyView(_filter != null ? 'No bills in this group. Tap the highlighted card again to show all bills.' : 'No open bills of MSME suppliers.'),
            for (final r in rows)
              RecordCard(
                code: '${r['invoice_number']}',
                title: '${r['vendor_name']} (${r['vendor_code']})',
                subtitle: '${r['msme_category']}',
                trailing: FinStatusPill(r['status'], labels: _msmeLabels, colors: _msmeHex),
                meta: [
                  ('Bill date', fmtDate(r['invoice_date'])),
                  ('Pay by', '${fmtDate(r['pay_by'])} (${r['limit_days']} d)'),
                  ('Days left', '${r['days_left']}'),
                  ('Amount due', inr(r['amount_due'])),
                ],
              ),
          ]);
        },
      ),
      SectionTitle('Sec. 43B(h) statement'),
      padded(AppSelect<int>(
        label: 'Financial year',
        value: _fy,
        clearable: false,
        options: [for (final y in years) Option(y, 'FY $y-${((y + 1) % 100).toString().padLeft(2, '0')}')],
        onChanged: (o) => setState(() => _fy = o?.value ?? _fy),
      )),
      ApiLoader<Json>(
        key: ValueKey(_fy),
        load: () async => asJson(await Api.get('/accounts/msme/43bh', query: {'fy_start_year': _fy})),
        builder: (ctx, r, _) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          padded(Text('Disallowed: ${inr(r['total_disallowed'])}', style: const TextStyle(fontWeight: FontWeight.w700))),
          InfoBanner('${r['note'] ?? ''} Medium enterprises and traders are listed separately — outside 43B(h).'),
          if (listOf(r['rows']).isEmpty) const EmptyView('Nothing disallowed for this year.'),
          for (final x in listOf(r['rows']))
            RecordCard(
              code: '${x['invoice_number']}',
              title: '${x['vendor_name']} (${x['msme_category']})',
              meta: [
                ('Udyam', txt(x['udyam_number'])),
                ('Bill date', fmtDate(x['invoice_date'])),
                ('Pay by', fmtDate(x['pay_by'])),
                ('Days beyond', '${x['days_beyond_limit']}'),
                ('Unpaid at 31 March', inr(x['unpaid_at_year_end'])),
              ],
            ),
        ]),
      ),
    ]);
  }
}
