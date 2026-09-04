import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../billing/subscription_provider.dart';
import '../push/device_id.dart';
import '../state/auth_provider.dart';
import '../state/ruling_jobs_provider.dart';
import '../state/settings_provider.dart';
import '../theme/accent_colors.dart';
import '../utils/external_links.dart';
import 'card_index_screen.dart';
import 'corrections_screen.dart';
import 'judges_screen.dart';
import 'login_screen.dart';
import 'paywall_screen.dart';
import 'usage_stats_screen.dart';

const _privacyPolicyUrl =
    'https://redcola1030503-svg.github.io/dm-ruling-bot/mobile-app-privacy-policy.html';
const _termsOfServiceUrl =
    'https://redcola1030503-svg.github.io/dm-ruling-bot/mobile-app-terms-of-service.html';
const _adsSettingsUrl = 'https://adssettings.google.com/authenticated?hl=ja';
const _feedbackEmail = 'red.cola1030503@gmail.com';

class SettingsScreen extends StatefulWidget {
  final ApiClient apiClient;

  const SettingsScreen({super.key, required this.apiClient});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final Future<PackageInfo> _packageInfo = PackageInfo.fromPlatform();
  bool _restoring = false;

  /// 購入の復元。ペイウォールに到達しなくても復元できるようにする
  /// (Appleの要件。またAndroidは再インストールでdeviceIdが変わるため、
  /// 購読者が無料枠を使い切るまでペイウォールに到達できない問題を回避する)。
  Future<void> _handleRestorePurchases() async {
    if (_restoring) return;
    final subscription = context.read<SubscriptionProvider>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _restoring = true);
    String message;
    try {
      final restored = await subscription.restorePurchases();
      if (restored) {
        try {
          final deviceId = await DeviceIdProvider().getOrCreate();
          await widget.apiClient.syncBilling(deviceId);
        } catch (_) {
          // 同期に失敗してもRevenueCatのWebhookが後追いで反映するため無視する
        }
        message = '購読を復元しました。';
      } else {
        message = '復元できる購読が見つかりませんでした。';
      }
    } catch (e) {
      // 未初期化などアプリ側で投げた日本語メッセージはそのまま表示する。
      message = e is StateError
          ? e.message
          : '購入の復元に失敗しました。しばらくしてから再度お試しください。';
    }
    if (!mounted) return;
    setState(() => _restoring = false);
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final apiClient = widget.apiClient;
    final auth = context.watch<AuthProvider>();
    final settings = context.watch<SettingsProvider>();
    final rulingJobs = context.watch<RulingJobsProvider>();
    final subscription = context.watch<SubscriptionProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('オプション')),
      body: ListView(
        children: [
          const _SectionHeader('通知'),
          SwitchListTile(
            secondary: const Icon(Icons.notifications_outlined),
            title: const Text('プッシュ通知'),
            subtitle: const Text('裁定生成が完了したときに通知します'),
            value: rulingJobs.notificationsEnabled,
            onChanged: (value) => rulingJobs.setNotificationsEnabled(value),
          ),
          const Divider(),
          const _SectionHeader('表示'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: SegmentedButton<ThemeMode>(
              segments: const [
                ButtonSegment(
                  value: ThemeMode.system,
                  label: Text('端末に合わせる'),
                  icon: Icon(Icons.brightness_auto),
                ),
                ButtonSegment(
                  value: ThemeMode.light,
                  label: Text('ライト'),
                  icon: Icon(Icons.light_mode_outlined),
                ),
                ButtonSegment(
                  value: ThemeMode.dark,
                  label: Text('ダーク'),
                  icon: Icon(Icons.dark_mode_outlined),
                ),
              ],
              selected: {settings.themeMode},
              onSelectionChanged: (selection) =>
                  settings.setThemeMode(selection.first),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text(
              'カラーパターン',
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final option in kAccentColorOptions)
                  _AccentColorSwatch(
                    option: option,
                    selected:
                        option.color.toARGB32() ==
                        settings.accentColor.toARGB32(),
                    onTap: () => settings.setAccentColor(option.color),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text('文字サイズ', style: Theme.of(context).textTheme.labelLarge),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(
              children: [
                Text('小', style: Theme.of(context).textTheme.bodySmall),
                Expanded(
                  child: Slider(
                    value: settings.textScale,
                    min: SettingsProvider.minTextScale,
                    max: SettingsProvider.maxTextScale,
                    divisions: 11,
                    label: '${(settings.textScale * 100).round()}%',
                    onChanged: (value) => settings.setTextScale(value),
                  ),
                ),
                Text('大', style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Text(
              '例: 《ボルメテウス・ホワイト・ドラゴン》でシールドをブレイクした場合、S・トリガーは使えますか？',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const Divider(),
          if (auth.isLoggedIn)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: Text(
                '${auth.session!.judgeId} (${auth.isAdmin ? '管理者' : 'ジャッジ'})',
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
          ListTile(
            leading: const Icon(Icons.bar_chart),
            title: const Text('ルール確認&利用統計'),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => UsageStatsScreen(apiClient: apiClient),
              ),
            ),
          ),
          if (auth.isLoggedIn) ...[
            ListTile(
              leading: const Icon(Icons.edit_note),
              title: Text(auth.isAdmin ? '訂正内容(全ジャッジ)' : '自分の訂正内容'),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => CorrectionsScreen(apiClient: apiClient),
                ),
              ),
            ),
            if (auth.isAdmin)
              ListTile(
                leading: const Icon(Icons.gavel),
                title: const Text('ジャッジ管理'),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => JudgesScreen(apiClient: apiClient),
                  ),
                ),
              ),
            if (auth.isAdmin)
              ListTile(
                leading: const Icon(Icons.style),
                title: const Text('カードインデックス管理'),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CardIndexScreen(apiClient: apiClient),
                  ),
                ),
              ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('ログアウト'),
              onTap: () => context.read<AuthProvider>().logout(),
            ),
          ] else ...[
            const Divider(),
            ListTile(
              leading: const Icon(Icons.login),
              title: const Text('ログイン'),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => LoginScreen(apiClient: apiClient),
                ),
              ),
            ),
          ],
          const Divider(),
          const _SectionHeader('購読'),
          ListTile(
            leading: Icon(
              subscription.isSubscribed
                  ? Icons.workspace_premium
                  : Icons.workspace_premium_outlined,
            ),
            title: Text(
              subscription.isSubscribed ? '質問し放題プラン(ご利用中)' : '質問し放題プランにアップグレード',
            ),
            subtitle: Text(
              subscription.isSubscribed
                  ? 'サブスクリプションの管理'
                  : '無料枠(月10問)超過・広告非表示',
            ),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => PaywallScreen(apiClient: apiClient),
              ),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.restore),
            title: const Text('購入を復元する'),
            subtitle: const Text('機種変更・再インストール後に購読を引き継ぎます'),
            trailing: _restoring
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : null,
            onTap: _restoring ? null : _handleRestorePurchases,
          ),
          const Divider(),
          const _SectionHeader('広告'),
          ListTile(
            leading: const Icon(Icons.ads_click_outlined),
            title: const Text('パーソナライズ広告の設定'),
            subtitle: const Text('Googleの広告設定ページを開きます'),
            onTap: () => openExternalUri(context, Uri.parse(_adsSettingsUrl)),
          ),
          const Divider(),
          const _SectionHeader('サポート'),
          ListTile(
            leading: const Icon(Icons.mail_outline),
            title: const Text('お問い合わせ・フィードバック'),
            subtitle: const Text('不具合報告やご要望はこちらから'),
            onTap: () => openExternalUri(
              context,
              Uri(
                scheme: 'mailto',
                path: _feedbackEmail,
                query: 'subject=${Uri.encodeComponent('デュエマ裁定確認アプリ お問い合わせ')}',
              ),
            ),
          ),
          const Divider(),
          const _SectionHeader('アプリ情報'),
          FutureBuilder<PackageInfo>(
            future: _packageInfo,
            builder: (context, snapshot) {
              final info = snapshot.data;
              final versionLabel = info != null
                  ? 'バージョン ${info.version} (${info.buildNumber})'
                  : 'バージョン情報を取得中…';
              return ListTile(
                leading: const Icon(Icons.info_outline),
                title: const Text('バージョン情報'),
                subtitle: Text(versionLabel),
              );
            },
          ),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: const Text('プライバシーポリシー'),
            onTap: () => openExternalUri(context, Uri.parse(_privacyPolicyUrl)),
          ),
          ListTile(
            leading: const Icon(Icons.description_outlined),
            title: const Text('利用規約'),
            onTap: () =>
                openExternalUri(context, Uri.parse(_termsOfServiceUrl)),
          ),
        ],
      ),
    );
  }

}

class _SectionHeader extends StatelessWidget {
  final String title;

  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        title,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}

class _AccentColorSwatch extends StatelessWidget {
  final AccentColorOption option;
  final bool selected;
  final VoidCallback onTap;

  const _AccentColorSwatch({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: option.name,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: option.color,
            shape: BoxShape.circle,
            border: selected
                ? Border.all(
                    color: Theme.of(context).colorScheme.onSurface,
                    width: 2,
                  )
                : null,
          ),
          child: selected
              ? Icon(
                  Icons.check,
                  color: option.color.computeLuminance() > 0.5
                      ? Colors.black
                      : Colors.white,
                )
              : null,
        ),
      ),
    );
  }
}
