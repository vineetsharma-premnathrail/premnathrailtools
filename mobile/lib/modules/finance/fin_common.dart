import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

/// Building blocks shared by every Finance screen - the phone version of
/// frontend/src/components/finance/financeUi.tsx (+ FinanceAttachments,
/// voucherLabels). Permission module key is `accounts`.

const kFinModule = 'accounts';

/// `can('accounts', tab, action)`.
bool finCan(String tab, String action) => Perm.can(kFinModule, tab, action);

/// `canFeature('accounts', tab, feature, action)`.
bool finCanFeature(String tab, String feature, String action) => Perm.canFeature(kFinModule, tab, feature, action);

/// Portal teal used by the Finance nav / accents.
const kFinTeal = Color(0xFF0F766E);

// ── Numbers and dates ────────────────────────────────────────────────────────

num? toNum(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);

double toD(Object? v) => (toNum(v) ?? 0).toDouble();

int? toInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));

/// Money like the portal's inr(): ₹ en-IN, negative in brackets.
String inr(Object? v, {bool blankZero = false}) {
  final n = toNum(v);
  if (n == null) return '—';
  if (blankZero && n.abs() < 0.005) return '';
  final s = fmtMoney(n.abs());
  return n < 0 ? '($s)' : s;
}

double round2(num x) => (x * 100).roundToDouble() / 100;

String todayIso() => apiDate(DateTime.now());

String currentPeriod() => todayIso().substring(0, 7);

/// Start of the Indian financial year (1-Apr) containing today.
DateTime fyStart() {
  final d = DateTime.now();
  return DateTime(d.month >= 4 ? d.year : d.year - 1, 4, 1);
}

String fyStartIso() => apiDate(fyStart());

/// Parse "YYYY-MM-DD" (no timezone shift) - for form date values.
DateTime? isoToDate(Object? v) {
  if (v is! String || v.length < 10) return null;
  return DateTime.tryParse(v.substring(0, 10));
}

String? dateOrNull(DateTime? d) => d == null ? null : apiDate(d);

/// String id → int (form selects send numbers).
int? idOf(Object? v) => toInt(v);

List<Json> asRows(Object? data) => ApiPage.from(data).rows;

Json asJson(Object? data) => data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};

List<Json> listOf(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

// ── Labels shared by Journals / voucher screens ──────────────────────────────

const kVoucherStatusLabels = {'draft': 'Draft', 'posted': 'Posted', 'reversed': 'Reversed', 'cancelled': 'Discarded'};
const kVoucherStatusHex = {
  'draft': Color(0xFF94A3B8),
  'posted': Color(0xFF16A34A),
  'reversed': Color(0xFFF59E0B),
  'cancelled': Color(0xFFDC2626),
};
const kVoucherLabels = {
  'journal': 'Journal', 'payment': 'Payment', 'receipt': 'Receipt', 'contra': 'Contra', 'purchase': 'Purchase',
  'sales': 'Sales', 'debit_note': 'Debit Note', 'credit_note': 'Credit Note', 'opening': 'Opening',
};
const kPostingLabels = {
  'adjustment': 'Adjustment', 'accrual': 'Accrual', 'correction': 'Correction', 'depreciation': 'Depreciation',
  'invoice': 'Invoice', 'payment': 'Payment', 'receipt': 'Receipt', 'contra': 'Contra', 'debit_note': 'Debit Note',
  'credit_note': 'Credit Note', 'opening': 'Opening', 'gst_setoff': 'GST Set-off', 'closing_stock': 'Closing Stock',
  'asset_disposal': 'Asset Disposal', 'year_end': 'Year End',
};
const kSourceDocuments = {
  'vendor_invoice': ('Vendor invoice', 'Finance › Purchase'),
  'ar_transaction': ('Sales invoice', 'Finance › Sales'),
  'party_note': ('Debit / credit note', 'Finance › Notes'),
  'payment_transaction': ('Payment voucher', 'Finance › Payments'),
  'depreciation_run': ('Depreciation run', 'Finance › Assets'),
  'fixed_asset': ('Fixed asset', 'Finance › Assets'),
  'inventory_valuation': ('Closing-stock valuation', 'Finance › Inventory'),
};

Color hexColor(String hex) {
  final h = hex.replaceAll('#', '');
  return Color(int.parse(h.length == 6 ? 'FF$h' : h, radix: 16));
}

/// The portal's StatusPill: label + colour from per-page maps.
class FinStatusPill extends StatelessWidget {
  const FinStatusPill(this.status, {super.key, this.labels = const {}, this.colors = const {}});
  final Object? status;
  final Map<String, String> labels;
  final Map<String, Color> colors;

  @override
  Widget build(BuildContext context) {
    final s = (status ?? '').toString();
    final label = labels[s] ?? s.replaceAll('_', ' ');
    final c = colors[s];
    return StatusBadge(label.isEmpty ? '—' : label, color: c);
  }
}

/// Approval-engine state of a draft (pending → "Awaiting approval · stage",
/// returned → "Returned for changes"); nothing otherwise.
class ApprovalBadge extends StatelessWidget {
  const ApprovalBadge({super.key, this.status, this.stage});
  final String? status;
  final String? stage;

  @override
  Widget build(BuildContext context) {
    if (status != 'pending' && status != 'returned') return const SizedBox.shrink();
    final pending = status == 'pending';
    final text = pending
        ? 'Awaiting approval${stage != null && stage!.isNotEmpty ? ' · $stage' : ''}'
        : 'Returned for changes';
    return StatusBadge(text, color: pending ? const Color(0xFFF59E0B) : const Color(0xFF7C3AED));
  }
}

/// After saving a draft, send it to its approvers. '' on success, else a
/// message saying the draft was kept and why it couldn't be sent.
Future<String> submitAfterSave(Future<void> Function() submit, String what) async {
  try {
    await submit();
    return '';
  } catch (e) {
    String reason = 'the approval workflow refused it';
    if (e is DioException) {
      final d = e.response?.data;
      if (d is Map && d['detail'] is String) reason = d['detail'] as String;
    }
    return '$what was saved as a draft, but it couldn\'t be sent for approval: $reason Fix that, then use "Submit for approval" on it.';
  }
}

// ── Banners, stat cards, rows ────────────────────────────────────────────────

enum Tone { info, warning, success, danger }

class InfoBanner extends StatelessWidget {
  const InfoBanner(this.text, {super.key, this.tone = Tone.info, this.child});
  final String text;
  final Tone tone;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final c = switch (tone) {
      Tone.info => const Color(0xFF0369A1),
      Tone.warning => const Color(0xFFB45309),
      Tone.success => const Color(0xFF15803D),
      Tone.danger => const Color(0xFFB91C1C),
    };
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: c.withValues(alpha: 0.2)),
      ),
      child: child ?? Text(text, style: TextStyle(color: c, fontSize: 12.5, height: 1.4)),
    );
  }
}

/// The portal's StatCard - label + big value; tappable when it filters.
class StatCard extends StatelessWidget {
  const StatCard(this.label, this.value, {super.key, this.tone, this.onTap, this.active = false});
  final String label;
  final String value;
  final Color? tone;
  final VoidCallback? onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final c = tone ?? Brand.heading;
    return Material(
      color: active ? c.withValues(alpha: 0.08) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: active ? c : Brand.border, width: active ? 1.5 : 1),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label.toUpperCase(),
                  maxLines: 2,
                  style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Brand.muted, letterSpacing: .4)),
              const SizedBox(height: 4),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: c)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Two-per-row grid of [StatCard]s (portal's flex-wrapped stat row).
class StatGrid extends StatelessWidget {
  const StatGrid(this.cards, {super.key, this.columns = 2});
  final List<Widget> cards;
  final int columns;

  @override
  Widget build(BuildContext context) {
    if (cards.isEmpty) return const SizedBox.shrink();
    final rows = <Widget>[];
    for (var i = 0; i < cards.length; i += columns) {
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var j = 0; j < columns; j++) ...[
                if (j > 0) const SizedBox(width: 8),
                Expanded(child: i + j < cards.length ? cards[i + j] : const SizedBox.shrink()),
              ],
            ],
          ),
        ),
      ));
    }
    return Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 4), child: Column(children: rows));
  }
}

/// Horizontal row of count chips (filters its list on tap).
class ChipRow extends StatelessWidget {
  const ChipRow(this.chips, {super.key});
  final List<Widget> chips;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 44,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
          children: chips,
        ),
      );
}

/// Label left, amount right (totals blocks, balances).
class AmountRow extends StatelessWidget {
  const AmountRow(this.label, this.value, {super.key, this.bold = false, this.color});
  final String label;
  final String value;
  final bool bold;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final st = TextStyle(
        fontSize: 13.5, fontWeight: bold ? FontWeight.w800 : FontWeight.w500, color: color ?? Brand.body);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: st)),
          const SizedBox(width: 12),
          Text(value, style: st.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
        ],
      ),
    );
  }
}

/// A plain report table, horizontally scrollable (trial balance, aging ...).
/// [numeric] = column indexes right-aligned.
class FinTable extends StatelessWidget {
  const FinTable({
    super.key,
    required this.columns,
    required this.rows,
    this.numeric = const {},
    this.boldRows = const {},
    this.onRowTap,
    this.emptyText = 'No rows.',
  });
  final List<String> columns;
  final List<List<String>> rows;
  final Set<int> numeric;
  final Set<int> boldRows;
  final void Function(int index)? onRowTap;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(emptyText, style: const TextStyle(color: Brand.muted)),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowHeight: 38,
            dataRowMinHeight: 36,
            dataRowMaxHeight: 56,
            columnSpacing: 18,
            horizontalMargin: 12,
            showCheckboxColumn: false,
            headingTextStyle: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Brand.muted),
            columns: [
              for (var i = 0; i < columns.length; i++) DataColumn(label: Text(columns[i]), numeric: numeric.contains(i)),
            ],
            rows: [
              for (var r = 0; r < rows.length; r++)
                DataRow(
                  onSelectChanged: onRowTap == null ? null : (_) => onRowTap!(r),
                  cells: [
                    for (var i = 0; i < columns.length; i++)
                      DataCell(ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 220),
                        child: Text(i < rows[r].length ? rows[r][i] : '',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: boldRows.contains(r) ? FontWeight.w800 : FontWeight.w400,
                                color: Brand.body)),
                      )),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Section title inside a scrolling page.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.action});
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        child: Row(children: [
          Expanded(
              child: Text(text, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Brand.heading))),
          ?action,
        ]),
      );
}

/// Small outlined pill button used in page headers ("Export", "Import" ...).
class PillButton extends StatelessWidget {
  const PillButton(this.label, {super.key, required this.onPressed, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          foregroundColor: Brand.body,
          minimumSize: const Size(0, 36),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          side: const BorderSide(color: Brand.border),
          shape: const StadiumBorder(),
        ),
        onPressed: onPressed,
        icon: Icon(icon ?? Icons.download_rounded, size: 16),
        label: Text(label, style: const TextStyle(fontSize: 13)),
      );
}

/// Row of action buttons for a SubPage bottom bar - wraps when many.
class ActionBar extends StatelessWidget {
  const ActionBar(this.actions, {super.key});
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.end, children: actions);
}

/// Compact button for [ActionBar].
Widget actionBtn(String label, VoidCallback? onPressed, {bool primary = false, bool danger = false}) {
  if (primary) {
    return FilledButton(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        backgroundColor: danger ? Brand.danger : null,
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
      onPressed: onPressed,
      child: Text(label),
    );
  }
  return OutlinedButton(
    style: OutlinedButton.styleFrom(
      minimumSize: const Size(0, 40),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      foregroundColor: danger ? Brand.danger : Brand.body,
      side: BorderSide(color: danger ? Brand.danger.withValues(alpha: 0.4) : Brand.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    onPressed: onPressed,
    child: Text(label),
  );
}

// ── Sub-tabs (portal useFinanceSubTabs + SubTabs) ─────────────────────────────

/// One in-page sub-tab. `permTab` = Finance & Accounting permission tab
/// key (may be `tab.feature`); null = always shown. [visible] overrides.
class FinSubTab {
  const FinSubTab(this.label, this.builder, {this.permTab, this.visible});
  final String label;
  final String? permTab;
  final bool? visible;
  final WidgetBuilder builder;

  bool get shown => visible ?? (permTab == null || finCan(permTab!, 'view'));
}

/// Page with a title block, optional banner and the in-page sub-tab chips
/// (portal: PageHeader + SubTabs). The selected sub-tab fills the rest.
class FinTabbedPage extends StatefulWidget {
  const FinTabbedPage({
    super.key,
    required this.title,
    this.subtitle,
    required this.tabs,
    this.noAccessText,
    this.headerActions = const [],
    this.showHeader = true,
  });
  final String title;
  final String? subtitle;
  final List<FinSubTab> tabs;
  final String? noAccessText;
  final List<Widget> headerActions;
  final bool showHeader;

  @override
  State<FinTabbedPage> createState() => _FinTabbedPageState();
}

class _FinTabbedPageState extends State<FinTabbedPage> {
  int _i = 0;
  bool _headerOpen = false;

  @override
  Widget build(BuildContext context) {
    final tabs = widget.tabs.where((t) => t.shown).toList();
    if (_i >= tabs.length) _i = 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.showHeader)
          InkWell(
            onTap: widget.subtitle == null ? null : () => setState(() => _headerOpen = !_headerOpen),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.title,
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Brand.heading)),
                        if (widget.subtitle != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(widget.subtitle!,
                                maxLines: _headerOpen ? null : 2,
                                overflow: _headerOpen ? null : TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 12.5, color: Brand.muted, height: 1.35)),
                          ),
                      ],
                    ),
                  ),
                  ...widget.headerActions,
                ],
              ),
            ),
          ),
        if (tabs.isEmpty)
          Expanded(
            child: ListView(children: [
              const SizedBox(height: 12),
              InfoBanner(widget.noAccessText ??
                  'You don\'t have view permission on any part of ${widget.title} (Finance & Accounting). '
                      'Ask an admin to grant it in Organization › Role & Permissions.',
                  tone: Tone.warning),
            ]),
          )
        else ...[
          if (tabs.length > 1)
            SizedBox(
              height: 46,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
                itemCount: tabs.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (ctx, i) {
                  final sel = i == _i;
                  return ChoiceChip(
                    label: Text(tabs[i].label),
                    selected: sel,
                    showCheckmark: false,
                    labelStyle: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: sel ? Brand.primaryActive : const Color(0xFF475569)),
                    selectedColor: Brand.primarySoft,
                    backgroundColor: Colors.white,
                    side: BorderSide(color: sel ? Brand.primary : Brand.border),
                    shape: const StadiumBorder(),
                    onSelected: (_) => setState(() => _i = i),
                  );
                },
              ),
            ),
          Expanded(child: KeyedSubtree(key: ValueKey('fin-sub-$_i'), child: Builder(builder: tabs[_i].builder))),
        ],
      ],
    );
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

/// From / To date pair in one row (report filters).
class DateRangeRow extends StatelessWidget {
  const DateRangeRow({super.key, required this.from, required this.to, required this.onChanged, this.fromLabel = 'From', this.toLabel = 'To'});
  final DateTime? from;
  final DateTime? to;
  final void Function(DateTime? from, DateTime? to) onChanged;
  final String fromLabel;
  final String toLabel;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: Row(children: [
          Expanded(child: DateField(label: fromLabel, value: from, onChanged: (d) => onChanged(d, to))),
          const SizedBox(width: 8),
          Expanded(child: DateField(label: toLabel, value: to, onChanged: (d) => onChanged(from, d))),
        ]),
      );
}

/// A filter control with page padding.
Widget padded(Widget child, {EdgeInsets padding = const EdgeInsets.fromLTRB(16, 4, 16, 8)}) =>
    Padding(padding: padding, child: child);

// ── Option loaders (cached for the session of the page) ──────────────────────

class FinLookups {
  FinLookups._();

  static List<Json>? _ledgers;
  static List<Json>? _gstRates;

  static void clear() {
    _ledgers = null;
    _gstRates = null;
  }

  /// All GL accounts (ledgers).
  static Future<List<Json>> ledgers({bool refresh = false}) async {
    if (_ledgers != null && !refresh) return _ledgers!;
    _ledgers = asRows(await Api.get('/accounts/gl-accounts'));
    return _ledgers!;
  }

  /// Active posting ledgers as select options: "code — name (group)".
  static Future<List<Option<int>>> ledgerOptions({bool Function(Json a)? filter}) async {
    final all = await ledgers();
    return [
      for (final a in all)
        if (a['status'] == 'active' && a['is_posting_account'] == true && (filter == null || filter(a)))
          Option<int>(toInt(a['id'])!, '${a['code']} — ${a['name']}',
              subtitle: a['group_name'] == null ? null : '${a['group_name']}'),
    ];
  }

  static String ledgerLabel(int? id) {
    if (id == null) return '';
    for (final a in _ledgers ?? const <Json>[]) {
      if (toInt(a['id']) == id) return '${a['code']} — ${a['name']}';
    }
    return '#$id';
  }

  static Future<List<Json>> gstRates() async {
    if (_gstRates != null) return _gstRates!;
    _gstRates = asRows(await Api.get('/accounts/gst-rates'));
    return _gstRates!;
  }

  /// Active GST rates as options (value = rate).
  static Future<List<Option<num>>> gstRateOptions() async {
    final r = await gstRates();
    final out = <Option<num>>[
      for (final g in r)
        if (g['is_active'] != false) Option<num>(toNum(g['rate']) ?? 0, '${fmtNumber(g['rate'])}%'),
    ];
    if (out.isEmpty) {
      for (final v in const [0, 5, 12, 18, 28]) {
        out.add(Option<num>(v, '$v%'));
      }
    }
    return out;
  }

  /// Active cost centres.
  static Future<List<Option<int>>> costCentres() async {
    final rows = asRows(await Api.get('/organization/cost-centers'));
    return [
      for (final c in rows)
        if (c['status'] == 'active') Option<int>(toInt(c['id'])!, '${c['code']} — ${c['name']}'),
    ];
  }

  /// Released (open / in progress) internal orders.
  static Future<List<Option<int>>> internalOrders() async {
    final rows = asRows(await Api.get('/accounts/internal-orders'));
    return [
      for (final o in rows)
        if (o['status'] == 'open' || o['status'] == 'in_progress') Option<int>(toInt(o['id'])!, '${o['code']} — ${o['name']}'),
    ];
  }

  /// Vendors (shared vendor master) - search on the server.
  static Future<List<Option<int>>> vendors(String search) async {
    final rows = asRows(await Api.get('/accounts/vendors', query: {'search': search}));
    return [
      for (final v in rows)
        Option<int>(toInt(v['id'])!, '${v['name'] ?? v['legal_name'] ?? ''}',
            subtitle: [v['code'], v['gstin']].where((x) => x != null && '$x'.isNotEmpty).join(' · ')),
    ];
  }
}

// ── GST line items (purchase / sales invoices, debit / credit notes) ─────────

class TaxLine {
  TaxLine({
    this.description = '',
    this.hsn = '',
    this.quantity = 1,
    this.uom = '',
    this.rate = 0,
    this.discount = 0,
    this.gstRate = 18,
    this.ledgerId,
    this.costCenterId,
    this.internalOrderId,
    this.poItemId,
    this.storeItemId,
  });

  factory TaxLine.fromJson(Json j) => TaxLine(
        description: '${j['description'] ?? ''}',
        hsn: '${j['hsn_sac_code'] ?? ''}',
        quantity: toD(j['quantity']),
        uom: '${j['uom'] ?? ''}',
        rate: toD(j['rate']),
        discount: toD(j['discount_amount']),
        gstRate: toD(j['gst_rate']),
        ledgerId: toInt(j['gl_account_id']),
        costCenterId: toInt(j['cost_center_id']),
        internalOrderId: toInt(j['internal_order_id']),
        poItemId: toInt(j['po_item_id']),
        storeItemId: toInt(j['store_item_id']),
      );

  String description;
  String hsn;
  double quantity;
  String uom;
  double rate;
  double discount;
  double gstRate;
  int? ledgerId;
  int? costCenterId;
  int? internalOrderId;
  int? poItemId;
  int? storeItemId;

  /// Gross rounded to the paisa first, as the server does.
  double get taxable => round2(round2(quantity * rate) - discount);

  Json toPayload({bool costObjects = false}) => {
        'description': description.trim(),
        'hsn_sac_code': hsn.trim().isEmpty ? null : hsn.trim(),
        'quantity': quantity,
        'uom': uom.trim().isEmpty ? null : uom.trim(),
        'rate': rate,
        'discount_amount': discount,
        'gst_rate': gstRate,
        'gl_account_id': ledgerId,
        if (costObjects) 'cost_center_id': costCenterId,
        if (costObjects) 'internal_order_id': internalOrderId,
        if (poItemId != null) 'po_item_id': poItemId,
        if (storeItemId != null) 'store_item_id': storeItemId,
      };
}

class TaxTotals {
  const TaxTotals(this.taxable, this.cgst, this.sgst, this.igst);
  final double taxable, cgst, sgst, igst;
  double get tax => round2(cgst + sgst + igst);
  double get total => round2(taxable + cgst + sgst + igst);
}

/// Same arithmetic as the server (services/gst.py) - a preview only.
TaxTotals previewTax(List<TaxLine> lines, bool interstate) {
  double taxable = 0, cgst = 0, sgst = 0, igst = 0;
  for (final l in lines) {
    final t = l.taxable;
    taxable += t;
    if (interstate) {
      igst += (t * l.gstRate).roundToDouble() / 100;
    } else {
      final half = (t * l.gstRate / 2).roundToDouble() / 100;
      cgst += half;
      sgst += half;
    }
  }
  return TaxTotals(round2(taxable), round2(cgst), round2(sgst), round2(igst));
}

/// Validates lines like the portal before save; throws a readable message.
void validateTaxLines(List<TaxLine> lines) {
  if (lines.isEmpty) throw 'Add at least one line - an invoice needs an item or service.';
  for (var i = 0; i < lines.length; i++) {
    final l = lines[i];
    if (l.description.trim().isEmpty) throw 'Line ${i + 1}: enter the description of the item / service.';
    if (l.quantity <= 0) throw 'Line ${i + 1}: quantity must be more than 0.';
    if (l.rate < 0) throw 'Line ${i + 1}: rate cannot be negative.';
    if (l.taxable < 0) throw 'Line ${i + 1}: discount is more than the line value - reduce the discount.';
  }
}

/// Phone version of TaxLinesEditor: one card per line + totals. Use inside
/// a showFormSheet builder, passing its setState.
class TaxLinesEditor extends StatelessWidget {
  const TaxLinesEditor({
    super.key,
    required this.lines,
    required this.setState,
    required this.interstate,
    this.ledgerHint,
    this.costObjects = false,
  });
  final List<TaxLine> lines;
  final StateSetter setState;

  /// null = party not picked yet.
  final bool? interstate;
  final String? ledgerHint;
  final bool costObjects;

  @override
  Widget build(BuildContext context) {
    final totals = previewTax(lines, interstate == true);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Caps('Lines (${lines.length})'),
        const SizedBox(height: 8),
        for (var i = 0; i < lines.length; i++) _LineCard(
          key: ObjectKey(lines[i]),
          index: i,
          line: lines[i],
          setState: setState,
          ledgerHint: ledgerHint,
          costObjects: costObjects,
          onRemove: lines.length > 1 ? () => setState(() => lines.removeAt(i)) : null,
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: () => setState(() => lines.add(TaxLine())),
            icon: const Icon(Icons.add_rounded, size: 18),
            label: const Text('Add line'),
          ),
        ),
        const SizedBox(height: 10),
        AmountRow('Taxable value', inr(totals.taxable)),
        if (interstate == null)
          const Text('Pick the party to see CGST/SGST vs IGST.', style: TextStyle(color: Brand.muted, fontSize: 12))
        else if (interstate == true)
          AmountRow('IGST', inr(totals.igst))
        else ...[
          AmountRow('CGST', inr(totals.cgst)),
          AmountRow('SGST', inr(totals.sgst)),
        ],
        AmountRow('Invoice value (before round-off)', inr(totals.total), bold: true),
      ],
    );
  }
}

class _LineCard extends StatelessWidget {
  const _LineCard({
    super.key,
    required this.index,
    required this.line,
    required this.setState,
    this.ledgerHint,
    this.costObjects = false,
    this.onRemove,
  });
  final int index;
  final TaxLine line;
  final StateSetter setState;
  final String? ledgerHint;
  final bool costObjects;
  final VoidCallback? onRemove;

  String _n(double v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  @override
  Widget build(BuildContext context) {
    final l = line;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            Text('Line ${index + 1}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
            const Spacer(),
            Text(inr(l.taxable), style: const TextStyle(fontWeight: FontWeight.w600)),
            if (onRemove != null)
              IconButton(
                  tooltip: 'Remove line',
                  icon: const Icon(Icons.close_rounded, size: 18, color: Brand.danger),
                  onPressed: onRemove),
          ]),
          const SizedBox(height: 6),
          AppTextField(
              label: 'Description', hint: 'Item / service', required: true, initialValue: l.description,
              onChanged: (v) => l.description = v),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: AppTextField(label: 'HSN/SAC', initialValue: l.hsn, onChanged: (v) => l.hsn = v)),
            const SizedBox(width: 8),
            Expanded(child: AppTextField(label: 'Unit', initialValue: l.uom, onChanged: (v) => l.uom = v)),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: AppTextField(
                  label: 'Qty', keyboardType: AppTextField.number, initialValue: _n(l.quantity),
                  onChanged: (v) => setState(() => l.quantity = double.tryParse(v) ?? 0)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: AppTextField(
                  label: 'Rate', keyboardType: AppTextField.number, initialValue: _n(l.rate),
                  onChanged: (v) => setState(() => l.rate = double.tryParse(v) ?? 0)),
            ),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: AppTextField(
                  label: 'Discount', keyboardType: AppTextField.number, initialValue: _n(l.discount),
                  onChanged: (v) => setState(() => l.discount = double.tryParse(v) ?? 0)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: AppSelect<num>(
                label: 'GST %',
                value: l.gstRate,
                valueLabel: '${_n(l.gstRate)}%',
                clearable: false,
                loadOptions: (_) => FinLookups.gstRateOptions(),
                onChanged: (o) => setState(() => l.gstRate = (o?.value ?? 0).toDouble()),
              ),
            ),
          ]),
          const SizedBox(height: 8),
          AppSelect<int>(
            label: 'Ledger${ledgerHint != null ? ' ($ledgerHint)' : ''}',
            value: l.ledgerId,
            valueLabel: l.ledgerId == null ? 'Default ledger' : FinLookups.ledgerLabel(l.ledgerId),
            loadOptions: (q) async => (await FinLookups.ledgerOptions())
                .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                .toList(),
            onChanged: (o) => setState(() => l.ledgerId = o?.value),
          ),
          if (costObjects) ...[
            const SizedBox(height: 8),
            AppSelect<int>(
              label: 'Cost centre',
              value: l.costCenterId,
              valueLabel: l.costCenterId == null ? null : '#${l.costCenterId}',
              loadOptions: (q) async => (await FinLookups.costCentres())
                  .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                  .toList(),
              onChanged: (o) => setState(() => l.costCenterId = o?.value),
            ),
            const SizedBox(height: 8),
            AppSelect<int>(
              label: 'Internal order',
              value: l.internalOrderId,
              valueLabel: l.internalOrderId == null ? null : '#${l.internalOrderId}',
              loadOptions: (q) async => (await FinLookups.internalOrders())
                  .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                  .toList(),
              onChanged: (o) => setState(() => l.internalOrderId = o?.value),
            ),
          ],
        ],
      ),
    );
  }
}

// ── Supporting documents (portal FinanceAttachments) ─────────────────────────

const kProofDocTypes = {
  'bill': 'Bill / tax invoice',
  'bank_proof': 'Bank advice / UTR proof',
  'working': 'Working / calculation',
  'approval': 'Approval mail / note',
  'customer_po': 'Customer PO',
  'delivery_proof': 'Signed delivery / LR copy',
  'other': 'Other',
};

/// Kinds offered on each document, most likely first.
const kProofKinds = {
  'vendor_invoice': ['bill', 'approval', 'other'],
  'party_note': ['bill', 'working', 'approval', 'other'],
  'ar_transaction': ['customer_po', 'delivery_proof', 'approval', 'other'],
  'journal': ['working', 'approval', 'bill', 'other'],
  'payment': ['bill', 'bank_proof', 'approval', 'other'],
};

/// Files on a saved Finance document. [tabKey] = permission tab whose
/// "proof" feature gates view / upload / delete. [locked] = posted or
/// cancelled (no removal); [closed] = cancelled (no upload either).
class FinanceAttachments extends StatefulWidget {
  const FinanceAttachments({
    super.key,
    required this.entityType,
    required this.entityId,
    required this.tabKey,
    this.locked = false,
    this.closed = false,
    this.required = false,
    this.title = 'Supporting documents',
  });
  final String entityType;
  final int entityId;
  final String tabKey;
  final bool locked;
  final bool closed;
  final bool required;
  final String title;

  @override
  State<FinanceAttachments> createState() => _FinanceAttachmentsState();
}

class _FinanceAttachmentsState extends State<FinanceAttachments> {
  List<Json>? _items;
  String? _error;
  bool _busy = false;

  bool get _canView => finCanFeature(widget.tabKey, 'proof', 'view');
  bool get _canUpload => finCanFeature(widget.tabKey, 'proof', 'create') && !widget.closed;
  bool get _canRemove => finCanFeature(widget.tabKey, 'proof', 'delete') && !widget.locked;

  @override
  void initState() {
    super.initState();
    if (_canView) _load();
  }

  Future<void> _load() async {
    try {
      final r = asRows(await Api.get('/accounts/attachments',
          query: {'entity_type': widget.entityType, 'entity_id': widget.entityId}));
      if (mounted) setState(() => _items = r);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _upload() async {
    final kinds = kProofKinds[widget.entityType] ?? const ['other'];
    String kind = kinds.first;
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Padding(padding: EdgeInsets.all(16), child: Caps('What kind of file?')),
          for (final k in kinds) ListTile(title: Text(kProofDocTypes[k] ?? k), onTap: () => Navigator.pop(ctx, k)),
        ]),
      ),
    );
    if (picked == null) return;
    kind = picked;
    final files = await Files.pickFiles();
    if (files.isEmpty || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final form = FormData();
      form.fields
        ..add(MapEntry('entity_type', widget.entityType))
        ..add(MapEntry('entity_id', '${widget.entityId}'))
        ..add(MapEntry('doc_type', kind));
      for (final f in files) {
        form.files.add(MapEntry('files', f));
      }
      await Api.dio.post('/accounts/attachments', data: form,
          options: Options(contentType: 'multipart/form-data', receiveTimeout: const Duration(seconds: 120)));
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(Json a) async {
    final ok = await confirmDialog(context,
        title: 'Delete file', message: 'Delete ${a['filename']}? This cannot be undone.', confirmLabel: 'Delete', danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/accounts/attachments/${a['id']}'), success: 'File deleted.')) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (!_canView) return const SizedBox.shrink();
    final items = _items;
    return DetailSection(
      widget.title,
      action: _canUpload
          ? TextButton.icon(
              onPressed: _busy ? null : _upload,
              icon: _busy
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.attach_file_rounded, size: 18),
              label: const Text('Attach'))
          : null,
      children: [
        if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 8)],
        if (items == null && _error == null)
          const Text('Loading…', style: TextStyle(color: Brand.muted))
        else if (items != null && items.isEmpty)
          Text(
            widget.required ? 'No file attached yet — attach one before this goes for approval.' : 'No files attached yet.',
            style: TextStyle(
                color: widget.required ? const Color(0xFFB45309) : Brand.muted,
                fontWeight: widget.required ? FontWeight.w600 : FontWeight.w400),
          )
        else
          for (final a in items ?? const <Json>[])
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: const Icon(Icons.insert_drive_file_outlined),
              title: Text('${a['filename']}', style: const TextStyle(color: Brand.primaryActive, fontWeight: FontWeight.w600)),
              subtitle: Text([
                kProofDocTypes['${a['doc_type']}'] ?? '${a['doc_type'] ?? ''}',
                if (a['uploaded_by_name'] != null) '${a['uploaded_by_name']}',
                fmtDateTime(a['created_at']),
              ].join(' · ')),
              onTap: () => runAction(
                  context, () => Files.downloadAndOpen('/accounts/attachments/${a['id']}/content', '${a['filename']}')),
              trailing: _canRemove
                  ? IconButton(
                      icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger), onPressed: () => _remove(a))
                  : null,
            ),
      ],
    );
  }
}

/// Download a server file (Excel / PDF / Word) and open it; snack on error.
Future<void> finDownload(BuildContext context, String path, String fileName, {Map<String, dynamic>? query}) =>
    runAction(context, () => Files.downloadAndOpen(path, fileName, query: query));

/// Upload one picked file as multipart field [field] (+ extra fields).
Future<dynamic> finUpload(String path, MultipartFile file, {String field = 'file', Map<String, String> fields = const {}}) async {
  final form = FormData();
  form.files.add(MapEntry(field, file));
  fields.forEach((k, v) => form.fields.add(MapEntry(k, v)));
  final r = await Api.dio.post(path, data: form,
      options: Options(contentType: 'multipart/form-data', receiveTimeout: const Duration(seconds: 120)));
  return r.data;
}

/// Sort rows ascending by a code/number key (portal rule: code/id A→Z).
List<Json> sortByCode(List<Json> rows, String key) {
  final out = [...rows];
  out.sort((a, b) => '${a[key] ?? ''}'.compareTo('${b[key] ?? ''}'));
  return out;
}

/// A list with a page header block above, wrapping ApiListView.
/// Use when a sub-tab is a simple list.
Widget finListHeader({List<Widget> children = const []}) =>
    Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);

// ── Approval panel (portal components/shared/ApprovalPanel) ──────────────────

const _reqLabel = {'pending': 'Waiting for approval', 'approved': 'Approved', 'rejected': 'Rejected', 'returned': 'Returned for changes', 'cancelled': 'Cancelled'};
const _reqHex = {'pending': Color(0xFFF59E0B), 'approved': Color(0xFF16A34A), 'rejected': Color(0xFFDC2626), 'returned': Color(0xFF7C3AED), 'cancelled': Color(0xFF78716C)};
const _stepLabel = {'waiting': 'Not yet', 'pending': 'Waiting', 'approved': 'Approved', 'rejected': 'Rejected', 'returned': 'Returned', 'skipped': 'Not needed', 'cancelled': 'Cancelled'};

/// Approval status + Approve / Return / Reject for one record from the
/// central approval engine (GET /approvals/entity/{type}/{id}). Renders
/// nothing when the record never went for approval.
class ApprovalPanel extends StatefulWidget {
  const ApprovalPanel({super.key, required this.entityType, required this.entityId, this.onChanged, this.title = 'Approval'});
  final String entityType;
  final int entityId;
  final VoidCallback? onChanged;
  final String title;

  @override
  State<ApprovalPanel> createState() => _ApprovalPanelState();
}

class _ApprovalPanelState extends State<ApprovalPanel> {
  Json? _data;
  String? _error;
  bool _busy = false;
  bool _history = false;
  final _comment = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = asJson(await Api.get('/approvals/entity/${widget.entityType}/${widget.entityId}'));
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _act(Future<dynamic> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
      _comment.clear();
      await _load();
      widget.onChanged?.call();
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _stages(Json req) {
    final steps = listOf(req['steps']);
    final groups = <int, List<Json>>{};
    for (final s in steps) {
      groups.putIfAbsent(toInt(s['sequence']) ?? 0, () => []).add(s);
    }
    final keys = groups.keys.toList()..sort();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final k in keys) ...[
          Padding(
            padding: const EdgeInsets.only(top: 6, bottom: 2),
            child: Text(
              '${groups[k]!.first['stage_name'] ?? 'Stage $k'}${groups[k]!.length > 1 ? (groups[k]!.first['approval_mode'] == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
            ),
          ),
          for (final s in groups[k]!)
            Padding(
              padding: const EdgeInsets.only(left: 8, bottom: 4),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${s['approver_name'] ?? '—'}', style: const TextStyle(fontSize: 13))),
                  StatusBadge(_stepLabel['${s['status']}'] ?? '${s['status']}'),
                ]),
                if (s['decided_by_name'] != null && s['decided_by_id'] != s['approver_id'])
                  Text('decided by ${s['decided_by_name']}', style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                if (s['decided_at'] != null)
                  Text(fmtDateTime(s['decided_at']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                if ((s['comment'] ?? '').toString().isNotEmpty)
                  Text('“${s['comment']}”', style: const TextStyle(fontSize: 12, color: Brand.body)),
              ]),
            ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null || (d['current'] == null && listOf(d['history']).isEmpty)) {
      return _error == null ? const SizedBox.shrink() : DetailSection(widget.title, children: [ErrorBanner(_error!)]);
    }
    final req = d['current'] is Map ? asJson(d['current']) : null;
    final history = listOf(d['history']);
    final canAct = req != null && req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
    return DetailSection(widget.title, children: [
      if (req != null) ...[
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          StatusBadge(_reqLabel['${req['status']}'] ?? '${req['status']}', color: _reqHex['${req['status']}']),
          Text(
              'Submitted by ${req['requester_name'] ?? '—'} on ${fmtDateTime(req['submitted_at'])}${(toInt(req['revision']) ?? 1) > 1 ? ' · submission #${req['revision']}' : ''}',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ]),
        _stages(req),
      ],
      if (_error != null) ...[const SizedBox(height: 8), ErrorBanner(_error!)],
      if (canAct) ...[
        const SizedBox(height: 10),
        if (req['acting_for'] != null)
          Text('You are deciding on behalf of ${req['acting_for']}.', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (req['can_decide'] != true && req['can_stand_in'] == true)
          const Text('You are not an approver of this stage — as an admin you can stand in; a comment is required.',
              style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        const SizedBox(height: 6),
        TextField(
          controller: _comment,
          maxLines: 3,
          minLines: 2,
          decoration: fieldDecoration('Comment', hint: 'Comment (required to reject or return)'),
        ),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          actionBtn('Approve', _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'approve', 'comment': _comment.text.trim()})), primary: true),
          actionBtn('Return for changes', _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'return', 'comment': _comment.text.trim()}))),
          actionBtn('Reject', _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'reject', 'comment': _comment.text.trim()})), danger: true),
        ]),
      ],
      if (req != null && req['status'] == 'pending' && req['can_cancel'] == true) ...[
        const SizedBox(height: 8),
        actionBtn('Withdraw approval request', _busy
            ? null
            : () async {
                final ok = await confirmDialog(context,
                    title: 'Withdraw approval request?',
                    message: 'The approvers will no longer see it. You can submit it again later.',
                    confirmLabel: 'Withdraw');
                if (ok) _act(() => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
              }),
      ],
      if (history.isNotEmpty) ...[
        TextButton(
          onPressed: () => setState(() => _history = !_history),
          child: Text('${_history ? 'Hide' : 'Show'} earlier submissions (${history.length})'),
        ),
        if (_history)
          for (final h in history) ...[
            const Divider(),
            Row(children: [
              StatusBadge(_reqLabel['${h['status']}'] ?? '${h['status']}', color: _reqHex['${h['status']}']),
              const SizedBox(width: 8),
              Text('Submission #${h['revision']} · ${fmtDateTime(h['submitted_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            _stages(h),
          ],
      ],
    ]);
  }
}

// ── Proof rules + picker on create forms ─────────────────────────────────────

class ProofRules {
  const ProofRules({this.purchaseInvoice = true, this.journal = true, this.payment = false, this.paymentAbove = 0});
  final bool purchaseInvoice;
  final bool journal;
  final bool payment;
  final double paymentAbove;

  static Future<ProofRules> load() async {
    try {
      final s = asJson(await Api.get('/accounts/settings'));
      final v = asJson(s['values']);
      return ProofRules(
        purchaseInvoice: v['proof_required_purchase_invoice'] != false,
        journal: v['proof_required_journal'] != false,
        payment: v['proof_required_payment'] == true,
        paymentAbove: toD(v['proof_required_payment_above']),
      );
    } catch (_) {
      return const ProofRules(); // the server enforces the real rule
    }
  }

  /// Whether a payment / receipt voucher of this type and amount needs a file.
  bool paymentNeedsProof(String paymentType, double amount) =>
      payment && const ['vendor', 'customer', 'expense', 'other_receipt'].contains(paymentType) && amount > paymentAbove;
}

/// A file chosen on a create form, with its kind.
class PickedProof {
  PickedProof(this.file, this.docType);
  final MultipartFile file;
  final String docType;
}

/// "Supporting documents" picker on a create form (portal ProofPicker).
class ProofPicker extends StatelessWidget {
  const ProofPicker({super.key, required this.entityType, required this.value, required this.setState, this.required = false, this.hint});
  final String entityType;
  final List<PickedProof> value;
  final StateSetter setState;
  final bool required;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final kinds = kProofKinds[entityType] ?? const ['other'];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Caps('Supporting documents${required ? ' *' : ''}'),
      if (hint != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(hint!, style: const TextStyle(fontSize: 12, color: Brand.muted))),
      for (final p in value)
        ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.insert_drive_file_outlined),
          title: Text(p.file.filename ?? 'file'),
          subtitle: Text(kProofDocTypes[p.docType] ?? p.docType),
          trailing: IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => setState(() => value.remove(p))),
        ),
      Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          icon: const Icon(Icons.attach_file_rounded, size: 18),
          label: const Text('Attach file'),
          onPressed: () async {
            final kind = await showModalBottomSheet<String>(
              context: context,
              builder: (ctx) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Padding(padding: EdgeInsets.all(16), child: Caps('What kind of file?')),
                  for (final k in kinds) ListTile(title: Text(kProofDocTypes[k] ?? k), onTap: () => Navigator.pop(ctx, k)),
                ]),
              ),
            );
            if (kind == null) return;
            final files = await Files.pickFiles();
            if (files.isEmpty) return;
            setState(() => value.addAll(files.map((f) => PickedProof(f, kind))));
          },
        ),
      ),
    ]);
  }
}

/// Uploads files picked on a create form to the saved record, grouped by kind.
/// '' on success, else a message saying what didn't upload.
Future<String> uploadPickedProof(String entityType, int entityId, List<PickedProof> picked, String what) async {
  final byKind = <String, List<MultipartFile>>{};
  for (final p in picked) {
    byKind.putIfAbsent(p.docType, () => []).add(p.file);
  }
  try {
    for (final e in byKind.entries) {
      final form = FormData();
      form.fields
        ..add(MapEntry('entity_type', entityType))
        ..add(MapEntry('entity_id', '$entityId'))
        ..add(MapEntry('doc_type', e.key));
      for (final f in e.value) {
        form.files.add(MapEntry('files', f));
      }
      await Api.dio.post('/accounts/attachments', data: form,
          options: Options(contentType: 'multipart/form-data', receiveTimeout: const Duration(seconds: 120)));
    }
    return '';
  } catch (e) {
    return '$what was saved as a draft, but its supporting document didn\'t upload: ${ApiClient.describe(e)} Open it and attach the file again.';
  }
}

/// Stages files for a record that isn't saved yet (payment vouchers) and
/// returns the attachment ids to send as attachment_ids.
Future<List<int>> stagePickedProof(List<PickedProof> picked) async {
  final ids = <int>[];
  final byKind = <String, List<MultipartFile>>{};
  for (final p in picked) {
    byKind.putIfAbsent(p.docType, () => []).add(p.file);
  }
  for (final e in byKind.entries) {
    final form = FormData();
    form.fields.add(MapEntry('doc_type', e.key));
    for (final f in e.value) {
      form.files.add(MapEntry('files', f));
    }
    final r = await Api.dio.post('/accounts/attachments/staged', data: form,
        options: Options(contentType: 'multipart/form-data', receiveTimeout: const Duration(seconds: 120)));
    for (final a in listOf(r.data)) {
      final id = toInt(a['id']);
      if (id != null) ids.add(id);
    }
  }
  return ids;
}

// ── Parties ──────────────────────────────────────────────────────────────────

/// Customers (CRM organisations) for pickers - server search.
Future<List<Option<int>>> customerOptions(String search) async {
  final rows = asRows(await Api.get('/crm/organizations', query: {'picker': true, 'search': search, 'limit': 50}));
  return [for (final c in rows) Option<int>(toInt(c['id'])!, '${c['name'] ?? ''}')];
}

/// Vendor + customer party picker values: `v:ID` / `c:ID`.
Future<List<Option<String>>> partyOptions(String search) async {
  final v = await FinLookups.vendors(search);
  final c = await customerOptions(search);
  return [
    for (final o in v) Option<String>('v:${o.value}', 'Vendor · ${o.label}', subtitle: o.subtitle),
    for (final o in c) Option<String>('c:${o.value}', 'Customer · ${o.label}'),
  ];
}

/// Logged-in user is a Finance Manager (or admin).
bool get isFinanceManager => Perm.user['is_finance_manager'] == true || Perm.user['role'] == 'admin';

/// "Nov 2026" from "2026-11".
String periodLabel(String p) {
  final parts = p.split('-');
  if (parts.length < 2) return p;
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final mi = int.tryParse(parts[1]) ?? 1;
  return '${m[(mi - 1).clamp(0, 11)]} ${parts[0]}';
}

/// "1,234.00 Dr" / "Cr" for signed balances (+ = Dr).
String drcr(Object? v) {
  final n = toNum(v);
  if (n == null) return '—';
  if (n.abs() < 0.005) return '0.00';
  return '${inr(n.abs())} ${n > 0 ? 'Dr' : 'Cr'}';
}
