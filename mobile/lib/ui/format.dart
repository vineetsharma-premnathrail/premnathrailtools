import 'package:intl/intl.dart';

/// Display formats - same as the portal (en-IN).

final _date = DateFormat('d MMM yyyy', 'en_IN');
final _dateTime = DateFormat('d MMM yyyy, h:mm a', 'en_IN');
final _money = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
final _number = NumberFormat.decimalPattern('en_IN');

DateTime? parseDate(Object? v) {
  if (v is DateTime) return v;
  if (v is String && v.isNotEmpty) return DateTime.tryParse(v)?.toLocal();
  return null;
}

/// "5 Nov 2026"; '—' when empty.
String fmtDate(Object? v) {
  final d = parseDate(v);
  return d == null ? '—' : _date.format(d);
}

/// "5 Nov 2026, 3:40 PM"; '—' when empty.
String fmtDateTime(Object? v) {
  final d = parseDate(v);
  return d == null ? '—' : _dateTime.format(d);
}

/// API date value: "2026-11-05".
String apiDate(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

num? _num(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);

/// "₹1,25,000.00"; '—' when empty.
String fmtMoney(Object? v, {String? currency}) {
  final n = _num(v);
  if (n == null) return '—';
  if (currency != null && currency.isNotEmpty && currency != 'INR') {
    return '$currency ${_number.format(n)}';
  }
  return _money.format(n);
}

/// "1,25,000"; '—' when empty.
String fmtNumber(Object? v) {
  final n = _num(v);
  return n == null ? '—' : _number.format(n);
}

/// Any value as text; '—' when null/empty.
String txt(Object? v) {
  if (v == null) return '—';
  final s = v.toString().trim();
  return s.isEmpty ? '—' : s;
}

/// "in_progress" → "In progress".
String humanize(Object? v) {
  final s = (v ?? '').toString().replaceAll('_', ' ').trim();
  if (s.isEmpty) return '—';
  return s[0].toUpperCase() + s.substring(1);
}
