import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'screens/ruling_screen.dart';
import 'state/auth_provider.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    final apiClient = ApiClient();
    final colorScheme = ColorScheme.fromSeed(seedColor: Colors.indigo);
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: apiClient),
        ChangeNotifierProvider(
          create: (_) => AuthProvider(apiClient: apiClient)..restoreSession(),
        ),
      ],
      child: MaterialApp(
        title: 'DM裁定確認',
        theme: ThemeData(
          colorScheme: colorScheme,
          fontFamily: 'NotoSansJP',
          appBarTheme: AppBarTheme(
            backgroundColor: colorScheme.primary,
            foregroundColor: colorScheme.onPrimary,
          ),
        ),
        home: _StartupGate(apiClient: apiClient),
      ),
    );
  }
}

class _StartupGate extends StatelessWidget {
  final ApiClient apiClient;

  const _StartupGate({required this.apiClient});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (auth.initializing) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return RulingScreen(apiClient: apiClient);
  }
}
