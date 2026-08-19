import 'ruling_job.dart';

class RulingThreadLatestJob {
  final String jobId;
  final String status;
  final String? outcomeStatus;
  final String? conclusion;

  const RulingThreadLatestJob({
    required this.jobId,
    required this.status,
    this.outcomeStatus,
    this.conclusion,
  });

  factory RulingThreadLatestJob.fromJson(Map<String, dynamic> json) {
    return RulingThreadLatestJob(
      jobId: json['jobId'] as String,
      status: json['status'] as String? ?? 'pending',
      outcomeStatus: json['outcomeStatus'] as String?,
      conclusion: json['conclusion'] as String?,
    );
  }
}

class RulingThreadSummary {
  final String threadId;
  final String title;
  final int createdAt;
  final int updatedAt;
  final int jobCount;
  final RulingThreadLatestJob? latestJob;

  const RulingThreadSummary({
    required this.threadId,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
    required this.jobCount,
    this.latestJob,
  });

  factory RulingThreadSummary.fromJson(Map<String, dynamic> json) {
    final latestJobJson = json['latestJob'] as Map<String, dynamic>?;
    return RulingThreadSummary(
      threadId: json['threadId'] as String,
      title: json['title'] as String? ?? '',
      createdAt: (json['createdAt'] as num?)?.toInt() ?? 0,
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
      jobCount: (json['jobCount'] as num?)?.toInt() ?? 0,
      latestJob: latestJobJson != null ? RulingThreadLatestJob.fromJson(latestJobJson) : null,
    );
  }
}

class RulingThreadDetail {
  final String threadId;
  final String title;
  final int createdAt;
  final int updatedAt;
  final List<RulingJob> jobs;

  const RulingThreadDetail({
    required this.threadId,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
    required this.jobs,
  });

  factory RulingThreadDetail.fromJson(Map<String, dynamic> json) {
    final jobsJson = json['jobs'] as List<dynamic>? ?? [];
    return RulingThreadDetail(
      threadId: json['threadId'] as String,
      title: json['title'] as String? ?? '',
      createdAt: (json['createdAt'] as num?)?.toInt() ?? 0,
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
      jobs: jobsJson.map((e) => RulingJob.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }
}
