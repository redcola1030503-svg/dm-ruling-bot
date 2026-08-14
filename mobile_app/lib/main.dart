import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'push/push_service.dart';
import 'screens/ruling_job_detail_screen.dart';
import 'screens/ruling_screen.dart';
import 'state/auth_provider.dart';
import 'state/ruling_jobs_provider.dart';

final navigatorKey = GlobalKey<NavigatorState>();

void main() {
  runApp(const MyApp());
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> with WidgetsBindingObserver {
  late final ApiClient _apiClient;
  late final PushService _pushService;
  late final RulingJobsProvider _rulingJobsProvider;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _apiClient = ApiClient();
    _pushService = PushService();
    _rulingJobsProvider = RulingJobsProvider(apiClient: _apiClient, pushService: _pushService);

    _pushService.initialize().then((_) {
      _pushService.listenNotificationTap(_openJobDetail);
    });
    _rulingJobsProvider.restore();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _rulingJobsProvider.refreshAllPending();
    }
  }

  void _openJobDetail(String jobId) {
    navigatorKey.currentState?.push(
      MaterialPageRoute(builder: (_) => RulingJobDetailScreen(jobId: jobId)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(seedColor: Colors.indigo);
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: _apiClient),
        ChangeNotifierProvider(
          create: (_) => AuthProvider(apiClient: _apiClient)..restoreSession(),
        ),
        ChangeNotifierProvider<RulingJobsProvider>.value(value: _rulingJobsProvider),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'DM裁定確認',
        theme: ThemeData(
          colorScheme: colorScheme,
          fontFamily: 'MPLUS1p',
          appBarTheme: AppBarTheme(
            backgroundColor: colorScheme.primary,
            foregroundColor: colorScheme.onPrimary,
          ),
        ),
        home: _StartupGate(apiClient: _apiClient),
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
