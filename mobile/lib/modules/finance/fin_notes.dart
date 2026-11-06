import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';

/// Pieces shared by Finance › Purchase and Finance › Sales: company GST
/// set-up, GST lines table, settlements, and debit / credit notes.

const kNoteReasonLabels = {
  'return': 'Goods returned', 'rate_difference': 'Rate difference', 'discount': 'Discount',
  'deficiency': 'Deficiency / shortage', 'other': 'Other',
};

bool isDraftNumber(Object? n) => '${n ?? ''}'.startsWith('DRAFT-');

/// GET /accounts/setup - company GST state, state codes, warnings.
class FinSetup {
  FinSetup(this.raw);
  final Json raw;

  static Future<FinSetup> load() async => FinSetup(asJson(await Api.get('/accounts/setup')));

  Map<String, String> get stateCodes =>
      {for (final e in asJson(raw['state_codes']).entries) e.key: '${e.value}'};
  String get companyState => '${asJson(raw['company_gst'])['state_code'] ?? ''}';
  List<String> get warnings => [for (final w in (raw['warnings'] is List ? raw['warnings'] as List : const [])) '$w'];

  List<Option<String>> get stateOptions {
    final e = stateCodes.entries.toList()..sort((a, b) => a.key.compareTo(b.key));
    return [for (final x in e) Option(x.key, '${x.key} — ${x.value}')];
  }

  /// A party's GST state code - from its GSTIN, else its state name.
  String? partyStateCode(Object? gstin, Object? state) {
    final codes = stateCodes;
    final g = '${gstin ?? ''}'.trim();
    if (g.length >= 2 && codes.containsKey(g.substring(0, 2))) return g.substring(0, 2);
    final s = '${state ?? ''}'.trim();
    if (s.isEmpty) return null;
    if (RegExp(r'^\d{1,2}$').hasMatch(s) && codes.containsKey(s.padLeft(2, '0'))) return s.padLeft(2, '0');
    final low = s.toLowerCase().replaceAll('&', 'and');
    for (final e in codes.entries) {
      if (e.value.toLowerCase() == low) return e.key;
    }
    return null;
  }
}

/// Read-only GST lines of a posted / saved document.
class TaxLinesView extends StatelessWidget {
  const TaxLinesView({super.key, required this.lines, required this.interstate});
  final List<Json> lines;
  final bool interstate;

  @override
  Widget build(BuildContext context) {
    return DetailSection('Lines (${lines.length})', children: [
      for (final l in lines)
        Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x140F172A)))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                  child: Text('${l['line_number'] ?? ''}. ${l['description'] ?? ''}',
                      style: const TextStyle(fontWeight: FontWeight.w600))),
              Text(inr(l['taxable_amount']), style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
            Text(
              [
                if ((l['hsn_sac_code'] ?? '').toString().isNotEmpty) 'HSN/SAC ${l['hsn_sac_code']}',
                '${fmtNumber(l['quantity'])}${(l['uom'] ?? '').toString().isNotEmpty ? ' ${l['uom']}' : ''} × ${inr(l['rate'])}',
                if (toD(l['discount_amount']) != 0) 'disc. ${inr(l['discount_amount'])}',
                'GST ${fmtNumber(l['gst_rate'])}%',
                '${interstate ? 'IGST' : 'CGST + SGST'} ${inr(interstate ? l['igst_amount'] : toD(l['cgst_amount']) + toD(l['sgst_amount']))}',
              ].join(' · '),
              style: const TextStyle(fontSize: 12, color: Brand.muted),
            ),
            if (l['gl_account_code'] != null)
              Text('Ledger: ${l['gl_account_code']} — ${l['gl_account_name'] ?? ''}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
          ]),
        ),
    ]);
  }
}

/// Settlement history of a bill / invoice.
class SettlementsSection extends StatelessWidget {
  const SettlementsSection({super.key, required this.path, required this.title, required this.emptyText, required this.sourceLabel});
  final String path;
  final String title;
  final String emptyText;
  final String Function(Json s) sourceLabel;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<dynamic>(
      future: Api.get(path),
      builder: (ctx, s) {
        final children = <Widget>[];
        if (s.connectionState != ConnectionState.done) {
          children.add(const Text('Loading settlements…', style: TextStyle(color: Brand.muted)));
        } else if (s.hasError) {
          children.add(ErrorBanner('Could not load the settlement history. ${ApiClient.describe(s.error!)}'));
        } else {
          final rows = asRows(s.data);
          if (rows.isEmpty) children.add(Text(emptyText, style: const TextStyle(color: Brand.muted)));
          for (final r in rows) {
            children.add(AmountRow('${fmtDate(r['allocation_date'])} · ${sourceLabel(r)} ${r['source_number'] ?? ''}', inr(r['amount'])));
          }
        }
        return DetailSection(title, children: children);
      },
    );
  }
}

// ── Debit / credit notes ─────────────────────────────────────────────────────

class _NoteKind {
  const _NoteKind(this.type);
  final String type; // debit_note | credit_note
  bool get debit => type == 'debit_note';
  String get tab => debit ? 'debit_notes' : 'credit_notes';
  String get word => debit ? 'debit note' : 'credit note';
  String get cap => debit ? 'Debit note' : 'Credit note';
  Map<String, String> get statusLabels =>
      debit ? const {'pending': 'Pending', 'posted': 'Posted', 'cancelled': 'Cancelled'} : const {'pending': 'Draft', 'posted': 'Posted', 'cancelled': 'Cancelled'};
}

const kDocStatusHex = {'pending': Color(0xFF94A3B8), 'posted': Color(0xFF22C55E), 'cancelled': Color(0xFF78716C)};

/// Debit Notes (Purchase) / Credit Notes (Sales) list.
class NotesTab extends StatefulWidget {
  const NotesTab({super.key, required this.noteType});
  final String noteType;

  @override
  State<NotesTab> createState() => _NotesTabState();
}

class _NotesTabState extends State<NotesTab> {
  final _list = GlobalKey<ApiListViewState>();
  late final _k = _NoteKind(widget.noteType);
  String? _status;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCan(_k.tab, 'create')
          ? CreateFab(
              label: _k.debit ? 'Raise debit note' : 'Issue credit note',
              onPressed: () async {
                if (await showNoteForm(context, widget.noteType)) _list.currentState?.reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async {
          final rows = sortByCode(asRows(await Api.get('/accounts/notes', query: {'note_type': widget.noteType})), 'note_number');
          return ApiPage(_status == null ? rows : rows.where((r) => r['status'] == _status).toList());
        },
        header: ChipRow([
          for (final e in _k.statusLabels.entries)
            CountChip(e.value, null,
                selected: _status == e.key,
                color: kDocStatusHex[e.key],
                onTap: () => setState(() {
                      _status = _status == e.key ? null : e.key;
                      _list.currentState?.reload();
                    })),
        ]),
        emptyText: _k.debit
            ? 'No debit notes yet — use + Raise debit note for a purchase return, rate difference or discount.'
            : 'No credit notes yet — use + Issue credit note for a return, rate difference or discount.',
        itemBuilder: (ctx, n, reload) => RecordCard(
          code: isDraftNumber(n['note_number']) ? 'Draft' : '${n['note_number']}',
          title: txt(n['party_name']),
          subtitle: n['original_invoice_number'] == null ? null : 'Against ${n['original_invoice_number']}',
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              FinStatusPill(n['status'], labels: _k.statusLabels, colors: kDocStatusHex),
              if (n['status'] == 'pending') ApprovalBadge(status: n['approval_status'] as String?, stage: n['approval_stage'] as String?),
            ]),
          ),
          meta: [
            ('Date', fmtDate(n['note_date'])),
            ('Reason', kNoteReasonLabels['${n['reason']}'] ?? '${n['reason']}'),
            ('Taxable', inr(n['taxable_amount'])),
            ('GST', inr(n['gst_amount'])),
            ('Total', inr(n['total_amount'])),
            ('Unadjusted', inr(n['unadjusted_amount'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => NoteScreen(noteId: toInt(n['id'])!, noteType: widget.noteType)));
            reload();
          },
        ),
      ),
    );
  }
}

class NoteScreen extends StatefulWidget {
  const NoteScreen({super.key, required this.noteId, required this.noteType});
  final int noteId;
  final String noteType;

  @override
  State<NoteScreen> createState() => _NoteScreenState();
}

class _NoteScreenState extends State<NoteScreen> {
  int _tick = 0;
  late final _k = _NoteKind(widget.noteType);

  Future<void> _do(Future<dynamic> Function() fn, String ok) async {
    if (await runAction(context, fn, success: ok)) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      key: ValueKey(_tick),
      load: () async => asJson(await Api.get('/accounts/notes/${widget.noteId}')),
      builder: (ctx, n, reload) {
        final pending = n['status'] == 'pending';
        final isMaker = Perm.userId != null && toInt(n['created_by_id']) == Perm.userId;
        final actions = <Widget>[
          if (pending && n['approval_status'] != 'pending' && finCan(_k.tab, 'submit'))
            actionBtn('Submit for approval', () => _do(() => Api.post('/accounts/notes/${n['id']}/submit'), 'Sent for approval.')),
          if (pending && !isMaker && finCan(_k.tab, 'approve'))
            actionBtn('Post', () => _do(() => Api.post('/accounts/notes/${n['id']}/post'), '${_k.cap} posted.'), primary: true),
          if (pending && finCan(_k.tab, 'delete'))
            actionBtn('Cancel', () async {
              final reason = await promptDialog(context,
                  title: 'Cancel this ${_k.word}?',
                  message: 'Only an unposted note can be cancelled.',
                  label: 'Reason for cancelling',
                  confirmLabel: 'Cancel note');
              if (reason != null) _do(() => Api.post('/accounts/notes/${n['id']}/cancel', data: {'reason': reason}), '${_k.cap} cancelled.');
            }, danger: true),
        ];
        return SubPage(
          title: isDraftNumber(n['note_number']) ? 'Draft ${_k.word}' : '${n['note_number']}',
          bottom: actions.isEmpty ? null : ActionBar(actions),
          body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Wrap(spacing: 8, runSpacing: 6, children: [
                FinStatusPill(n['status'], labels: _k.statusLabels, colors: kDocStatusHex),
                if (pending) ApprovalBadge(status: n['approval_status'] as String?, stage: n['approval_stage'] as String?),
              ]),
            ),
            if (pending && isMaker)
              const InfoBanner('You raised this note, so a different finance user must post it (maker-checker).'),
            if (pending) ApprovalPanel(entityType: 'accounts_party_note', entityId: toInt(n['id'])!, onChanged: reload),
            DetailSection(_k.cap, children: [
              FieldRow(_k.debit ? 'Vendor' : 'Customer', n['party_name']),
              FieldRow(_k.debit ? 'Against bill' : 'Against invoice', n['original_invoice_number']),
              FieldRow('Date', fmtDate(n['note_date'])),
              FieldRow('Reason', kNoteReasonLabels['${n['reason']}'] ?? n['reason']),
            ]),
            TaxLinesView(lines: listOf(n['lines']), interstate: n['is_interstate'] == true),
            DetailSection('Tax', children: [
              FieldRow(_k.debit ? 'Vendor GSTIN' : 'Customer GSTIN', n['party_gstin']),
              FieldRow('Place of supply', n['place_of_supply_state_code']),
              AmountRow('Taxable', inr(n['taxable_amount'])),
              AmountRow(n['is_interstate'] == true ? 'IGST' : 'CGST + SGST',
                  n['is_interstate'] == true ? inr(n['igst_amount']) : '${inr(n['cgst_amount'])} + ${inr(n['sgst_amount'])}'),
              if (toD(n['round_off']) != 0) AmountRow('Round-off', inr(n['round_off'])),
              AmountRow('Total', inr(n['total_amount']), bold: true),
              AmountRow('Unadjusted', inr(n['unadjusted_amount'])),
            ]),
            DetailSection('Record', children: [
              FieldRow('Narration', n['narration']),
              FieldRow('Raised by', n['created_by_name']),
            ]),
            FinanceAttachments(
                entityType: 'party_note', entityId: toInt(n['id'])!, tabKey: _k.tab, locked: !pending, closed: n['status'] == 'cancelled'),
          ]),
        );
      },
    );
  }
}

/// Raise debit note / Issue credit note form. True when saved.
Future<bool> showNoteForm(BuildContext context, String noteType) async {
  final k = _NoteKind(noteType);
  FinSetup? setup;
  List<Json> docs = [];
  try {
    setup = await FinSetup.load();
    docs = asRows(await Api.get(k.debit ? '/accounts/vendor-invoices' : '/accounts/ar-transactions', query: {'status': 'posted'}));
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return false;
  }
  int? docId;
  int? vendorId;
  String? vendorLabel;
  Json? vendor;
  DateTime noteDate = DateTime.now();
  String reason = 'return';
  final roundOff = TextEditingController(text: '0');
  final narration = TextEditingController();
  final lines = [TaxLine()];
  final proof = <PickedProof>[];
  String warning = '';
  Json? doc() {
    for (final d in docs) {
      if (toInt(d['id']) == docId) return d;
    }
    return null;
  }

  if (!context.mounted) return false;
  final saved = await showFormSheet(
    context,
    title: k.debit ? 'Raise debit note' : 'Issue credit note',
    saveLabel: k.debit ? 'Save debit note' : 'Save credit note',
    builder: (ctx, setS) {
      final d = doc();
      bool? interstate;
      if (d != null) {
        interstate = d['is_interstate'] == true;
      } else if (vendor != null) {
        final vs = setup!.partyStateCode(vendor!['gstin'], vendor!['state']);
        interstate = vs != null && setup.companyState.isNotEmpty ? vs != setup.companyState : null;
      }
      String? deadline;
      if (!k.debit && d != null) {
        final dt = isoToDate(d['invoice_date']);
        if (dt != null) deadline = '${dt.month >= 4 ? dt.year + 1 : dt.year}-11-30';
      }
      final pastDeadline = deadline != null && apiDate(noteDate).compareTo(deadline) > 0;
      return [
        Text(
            k.debit
                ? 'A purchase return or a reduction of a vendor bill — it reverses the input GST on that value.'
                : 'A sales return or a reduction of an issued tax invoice — it reduces the output GST on it.',
            style: const TextStyle(color: Brand.muted)),
        if (k.debit)
          const InfoBanner(
              'A debit note covers a rate difference, discount, shortage or goods sent back. Once posted it is set off against the bill automatically, '
              'so less is payable to the vendor.')
        else
          const InfoBanner(
              'A credit note must name the original invoice. GST can be reduced only if the note is issued by 30 November after the end of the '
              'invoice\'s financial year (CGST Act s.34) — after that, issue it at 0% GST.'),
        if (k.debit && d?['is_reverse_charge'] == true)
          const InfoBanner(
              'This bill was under reverse charge — the note reduces the RCM liability and credit, not the amount owed to the vendor for GST.',
              tone: Tone.warning),
        if (pastDeadline)
          InfoBanner(
              'This note is dated after ${fmtDate(deadline)}, so GST on invoice ${d?['invoice_number']} can no longer be reduced — set the GST rate to 0% on every line (a financial credit note).',
              tone: Tone.warning),
        const Caps('Against'),
        AppSelect<int>(
          label: k.debit ? 'Against purchase invoice' : 'Against sales invoice',
          required: !k.debit,
          value: docId,
          options: [
            for (final b in docs)
              Option(
                toInt(b['id'])!,
                '${b['invoice_number']} — ${k.debit ? b['vendor_name'] ?? '' : b['customer_name'] ?? ''}',
                subtitle: '${fmtDate(b['invoice_date'])} · ${inr(k.debit ? b['invoice_total'] : b['total_amount'])}',
              ),
          ],
          onChanged: (o) => setS(() => docId = o?.value),
        ),
        if (d != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => setS(() {
                lines
                  ..clear()
                  ..addAll(listOf(d['lines']).map(TaxLine.fromJson));
                if (lines.isEmpty) lines.add(TaxLine());
              }),
              child: Text('Copy lines from invoice ${d['invoice_number']}'),
            ),
          ),
        if (k.debit && docId == null)
          AppSelect<int>(
            label: 'Vendor',
            required: true,
            value: vendorId,
            valueLabel: vendorLabel,
            loadOptions: FinLookups.vendors,
            onChanged: (o) async {
              setS(() {
                vendorId = o?.value;
                vendorLabel = o?.label;
                vendor = null;
              });
              if (o != null) {
                try {
                  final rows = asRows(await Api.get('/accounts/vendors', query: {'search': o.label}));
                  for (final r in rows) {
                    if (toInt(r['id']) == o.value) setS(() => vendor = r);
                  }
                } catch (_) {}
              }
            },
          ),
        const Caps('Note'),
        DateField(label: 'Note date', required: true, value: noteDate, onChanged: (v) => setS(() => noteDate = v ?? noteDate)),
        AppSelect<String>(
          label: 'Reason',
          required: true,
          value: reason,
          clearable: false,
          options: [for (final e in kNoteReasonLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => reason = o?.value ?? reason),
        ),
        TaxLinesEditor(lines: lines, setState: setS, interstate: interstate, ledgerHint: k.debit ? 'default: Purchases' : null),
        AppTextField(
            label: 'Narration',
            controller: narration,
            maxLines: 3,
            hint: k.debit ? 'e.g. 12 pcs returned vide our challan no. …' : null),
        ProofPicker(
          entityType: 'party_note',
          value: proof,
          setState: setS,
          hint: k.debit ? 'Optional — e.g. the return challan, the vendor\'s credit note or the email agreeing the rate difference.' : null,
        ),
        AppTextField(label: 'Round-off (₹)', controller: roundOff, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true)),
      ];
    },
    onSave: () async {
      if (k.debit && docId == null && vendorId == null) {
        throw 'Pick the purchase invoice the note corrects — or, for a general adjustment, the vendor.';
      }
      if (!k.debit && docId == null) {
        throw 'Pick the issued sales invoice this credit note corrects — GSTR-1 reports a credit note against its original invoice.';
      }
      final ro = double.tryParse(roundOff.text) ?? 0;
      if (ro.abs() >= 1) throw 'Round-off only absorbs paise — it must be less than ₹1 either way.';
      validateTaxLines(lines);
      final created = asJson(await Api.post('/accounts/notes', data: {
        'note_type': noteType,
        'note_date': apiDate(noteDate),
        'reason': reason,
        if (k.debit) 'vendor_invoice_id': docId,
        if (k.debit) 'vendor_id': docId == null ? vendorId : null,
        if (!k.debit) 'ar_transaction_id': docId,
        'round_off': ro,
        'narration': narration.text.trim().isEmpty ? null : narration.text.trim(),
        'lines': [for (final l in lines) l.toPayload()],
      }));
      final id = toInt(created['id'])!;
      final proofWarning = proof.isEmpty ? '' : await uploadPickedProof('party_note', id, proof, 'The ${k.word}');
      final submitWarning = finCan(k.tab, 'submit') && proofWarning.isEmpty
          ? await submitAfterSave(() => Api.post('/accounts/notes/$id/submit'), 'The ${k.word}')
          : '';
      warning = [proofWarning, submitWarning].where((s) => s.isNotEmpty).join(' ');
    },
  );
  if (saved && context.mounted) showSnack(context, warning.isEmpty ? '${k.cap} saved.' : warning, error: warning.isNotEmpty);
  return saved;
}
