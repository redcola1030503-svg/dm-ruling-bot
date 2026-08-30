class ApiException implements Exception {
  final int? statusCode;
  final String message;

  const ApiException(this.message, {this.statusCode});

  bool get isSubscriptionRequired =>
      statusCode == 402 && message == 'subscription_required';

  /// サーバーが返す内部エラーコード(スネークケースの識別子)を
  /// ユーザー向けの日本語メッセージに変換する。未知のコードはそのまま表示する。
  String get friendlyMessage {
    switch (message) {
      case 'invalid_judge_id':
        return '無効なジャッジIDです。';
      case 'already_running':
        return '既に処理が実行中です。';
      case 'busy':
        return '現在混雑しています。しばらくしてから再度お試しください。';
      case 'subscription_required':
        return '無料枠の上限に達しました。';
      default:
        if (statusCode == 429) {
          return 'リクエストが多すぎます。しばらく待ってから再度お試しください。';
        }
        return message;
    }
  }

  @override
  String toString() => message;
}
