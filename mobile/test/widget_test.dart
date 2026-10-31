import 'package:flutter_test/flutter_test.dart';

import 'package:premnath_erp/screens/login_screen.dart';
import 'package:flutter/material.dart';

void main() {
  testWidgets('login screen explains missing build settings', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    expect(find.text('Login with Microsoft'), findsOneWidget);
    expect(find.textContaining('App setup is incomplete'), findsOneWidget);
  });
}
