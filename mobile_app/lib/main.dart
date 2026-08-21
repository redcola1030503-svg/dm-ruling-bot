import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'push/push_service.dart';
import 'screens/ruling_job_detail_screen.dart';
import 'screens/ruling_screen.dart';
import 'screens/ruling_thread_detail_screen.dart';
import 'state/auth_provider.dart';
import 'state/ruling_jobs_provider.dart';
import 'state/settings_provider.dart';

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
  late final SettingsProvider _settingsProvider;

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
    _settingsProvider = SettingsProvider();

    _pushService.initialize().then((_) {
      _pushService.listenNotificationTap(_openJobOrThreadDetail);
    });
    _rulingJobsProvider.restore();
    _settingsProvider.restore();
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
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: _apiClient),
        ChangeNotifierProvider(
          create: (_) => AuthProvider(apiClient: _apiClient)..restoreSession(),
        ),
        ChangeNotifierProvider<RulingJobsProvider>.value(
          value: _rulingJobsProvider,
        ),
        ChangeNotifierProvider<SettingsProvider>.value(
          value: _settingsProvider,
        ),
      ],
      child: Consumer<SettingsProvider>(
        builder: (context, settings, _) {
          final lightScheme = ColorScheme.fromSeed(
            seedColor: settings.accentColor,
          );
          final darkScheme = ColorScheme.fromSeed(
            seedColor: settings.accentColor,
            brightness: Brightness.dark,
          );
          return MaterialApp(
            navigatorKey: navigatorKey,
            title: 'DM裁定確認',
            // テキスト選択メニュー(コピー・貼り付け等)を日本語表示にする。
            localizationsDelegates: const [
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            supportedLocales: const [Locale('ja')],
            locale: const Locale('ja'),
            builder: (context, child) {
              return MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(settings.textScale)),
                child: child!,
              );
            },
            themeMode: settings.themeMode,
            theme: ThemeData(
              colorScheme: lightScheme,
              scaffoldBackgroundColor: const Color(0xFFEEF3F6),
              fontFamily: 'MPLUS1p',
              appBarTheme: AppBarTheme(
                backgroundColor: Colors.white,
                foregroundColor: lightScheme.onSurface,
                surfaceTintColor: Colors.transparent,
                elevation: 0,
                shape: Border(
                  bottom: BorderSide(color: lightScheme.outlineVariant),
                ),
              ),
            ),
            darkTheme: ThemeData(
              colorScheme: darkScheme,
              scaffoldBackgroundColor: const Color(0xFF14181C),
              fontFamily: 'MPLUS1p',
              appBarTheme: AppBarTheme(
                backgroundColor: darkScheme.surface,
                foregroundColor: darkScheme.onSurface,
                surfaceTintColor: Colors.transparent,
                elevation: 0,
                shape: Border(
                  bottom: BorderSide(color: darkScheme.outlineVariant),
                ),
              ),
            ),
            home: _StartupGate(apiClient: _apiClient),
          );
        },
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
