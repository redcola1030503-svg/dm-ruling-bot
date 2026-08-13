import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile_app/main.dart';

void main() {
  // flutter_secure_storageは実機のプラットフォームチャンネルを使うため、
  // テスト環境では未実装のままだとAuthProvider.restoreSession()が終わらず
  // pumpAndSettleがタイムアウトする。読み書きとも「値なし」を返すモックに置き換える。
  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  TestWidgetsFlutterBinding.ensureInitialized();
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, (call) async => null);

  testWidgets('起動すると裁定質問画面が表示される', (WidgetTester tester) async {
    await tester.pumpWidget(const MyApp());
    await tester.pumpAndSettle();

    expect(find.text('DM裁定確認'), findsOneWidget);
    expect(find.text('質問する'), findsOneWidget);
  });
}
