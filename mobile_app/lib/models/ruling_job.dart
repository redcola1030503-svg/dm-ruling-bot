import 'ruling_result.dart';

enum RulingJobStatus { pending, running, done, failed }

RulingJobStatus _parseStatus(String? value) {
  switch (value) {
    case 'running':
      return RulingJobStatus.running;
    case 'done':
      return RulingJobStatus.done;
    case 'failed':
      return RulingJobStatus.failed;
    case 'pending':
    default:
      return RulingJobStatus.pending;
  }
}

class RulingJob {
  final String jobId;
  final String question;
  final RulingJobStatus status;
  final String? outcomeStatus;
  final RulingResult? result;
  final String? error;
  final int createdAt;

  const RulingJob({
    required this.jobId,
    required this.question,
    required this.status,
    this.outcomeStatus,
    this.result,
    this.error,
    required this.createdAt,
  });

  bool get isFinished => status == RulingJobStatus.done || status == RulingJobStatus.failed;

  factory RulingJob.fromJson(Map<String, dynamic> json, {String? question}) {
    final resultJson = json['result'] as Map<String, dynamic>?;
    return RulingJob(
      jobId: json['jobId'] as String,
      question: question ?? '',
      status: _parseStatus(json['status'] as String?),
      outcomeStatus: json['outcomeStatus'] as String?,
      result: resultJson != null ? RulingResult.fromJson(resultJson) : null,
      error: json['error'] as String?,
      createdAt: (json['createdAt'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
    );
  }

  RulingJob copyWith({
    RulingJobStatus? status,
    String? outcomeStatus,
    RulingResult? result,
    String? error,
  }) {
    return RulingJob(
      jobId: jobId,
      question: question,
      status: status ?? this.status,
      outcomeStatus: outcomeStatus ?? this.outcomeStatus,
      result: result ?? this.result,
      error: error ?? this.error,
      createdAt: createdAt,
    );
  }

  Map<String, dynamic> toStorageJson() => {
        'jobId': jobId,
        'question': question,
        'status': status.name,
        'outcomeStatus': outcomeStatus,
        'result': result == null
            ? null
            : {
                'conclusion': result!.conclusion,
                'explanation': result!.explanation,
                'steps': result!.steps,
                'confidence': result!.confidence,
                'cards': result!.cards,
                'sources': result!.sources,
              },
        'error': error,
        'createdAt': createdAt,
      };

  factory RulingJob.fromStorageJson(Map<String, dynamic> json) {
    final resultJson = json['result'] as Map<String, dynamic>?;
    return RulingJob(
      jobId: json['jobId'] as String,
      question: json['question'] as String? ?? '',
      status: _parseStatus(json['status'] as String?),
      outcomeStatus: json['outcomeStatus'] as String?,
      result: resultJson != null ? RulingResult.fromJson(resultJson) : null,
      error: json['error'] as String?,
      createdAt: (json['createdAt'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
    );
  }
}
