import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../billing/subscription_provider.dart';
import '../push/device_id.dart';

/// 無料枠(月10問)を超えた際に表示するペイウォール画面。
/// 購入・復元のいずれかが成功すると呼び出し元にtrueを返して閉じる。
class PaywallScreen extends StatefulWidget {
  final ApiClient apiClient;

  const PaywallScreen({super.key, required this.apiClient});

  @override
  State<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends State<PaywallScreen> {
  bool _processing = false;
  String? _error;

  Future<void> _handlePurchase() async {
    setState(() {
      _processing = true;
      _error = null;
    });
    try {
      await context.read<SubscriptionProvider>().purchase();
      final deviceId = await DeviceIdProvider().getOrCreate();
      await widget.apiClient.syncBilling(deviceId);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = '購入に失敗しました: $e');
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  Future<void> _handleRestore() async {
    setState(() {
      _processing = true;
      _error = null;
    });
    try {
      final restored = await context.read<SubscriptionProvider>().restorePurchases();
      if (restored) {
        final deviceId = await DeviceIdProvider().getOrCreate();
        await widget.apiClient.syncBilling(deviceId);
        if (mounted) Navigator.pop(context, true);
      } else if (mounted) {
        setState(() => _error = '有効な購読が見つかりませんでした。');
      }
    } catch (e) {
      if (mounted) setState(() => _error = '復元に失敗しました: $e');
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('質問し放題プラン')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              '無料枠(月10問)を使い切りました',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            const Text(
              '月額300円で質問し放題になります。\n運営コストを賄うための最小限の価格設定です。',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 16),
            ],
            FilledButton(
              onPressed: _processing ? null : _handlePurchase,
              child: _processing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('月額300円で購読する'),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _processing ? null : _handleRestore,
              child: const Text('購入を復元する'),
            ),
          ],
        ),
      ),
    );
  }
}
