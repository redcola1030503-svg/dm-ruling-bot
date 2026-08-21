import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'push/push_service.dart';
import 'screens/ruling_job_detail_screen.dart';
import 'screens/ruling_screen.dart';
import 'screens/ruling_thread_detail_screen.dart';
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
    _rulingJobsProvider = RulingJobsProvider(
      apiClient: _apiClient,
      pushService: _pushService,
    );

    _pushService.initialize().then((_) {
      _pushService.listenNotificationTap(_openJobOrThreadDetail);
    });
    _rulingJobsProvider.restore();
    MobileAds.instance.initialize();
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

  void _openJobOrThreadDetail(String jobId, String? threadId) {
    if (threadId != null && threadId.isNotEmpty) {
      navigatorKey.currentState?.push(
        MaterialPageRoute(
          builder: (_) => RulingThreadDetailScreen(threadId: threadId),
        ),
      );
    } else {
      navigatorKey.currentState?.push(
        MaterialPageRoute(builder: (_) => RulingJobDetailScreen(jobId: jobId)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    // トーク画面のような親しみやすさを狙い、既存の藍色ブランドから
    // メッセージアプリでお馴染みのグリーンを基調にした配色へ変更。
    final colorScheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF4CAF78),
    );
    const scaffoldBackground = Color(0xFFEEF3F6);
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: _apiClient),
        ChangeNotifierProvider(
          create: (_) => AuthProvider(apiClient: _apiClient)..restoreSession(),
        ),
        ChangeNotifierProvider<RulingJobsProvider>.value(
          value: _rulingJobsProvider,
        ),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'DM裁定確認',
        theme: ThemeData(
          colorScheme: colorScheme,
          scaffoldBackgroundColor: scaffoldBackground,
          fontFamily: 'MPLUS1p',
          appBarTheme: AppBarTheme(
            backgroundColor: Colors.white,
            foregroundColor: colorScheme.onSurface,
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            shape: Border(
              bottom: BorderSide(color: colorScheme.outlineVariant),
            ),
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
