import * as migration_20260920_153759_initial_schema from './20260920_153759_initial_schema';
import * as migration_20260920_160000_testimonial_consent_check from './20260920_160000_testimonial_consent_check';
import * as migration_20260921_071137_jobs_stats_global from './20260921_071137_jobs_stats_global';

export const migrations = [
  {
    up: migration_20260920_153759_initial_schema.up,
    down: migration_20260920_153759_initial_schema.down,
    name: '20260920_153759_initial_schema',
  },
  {
    up: migration_20260920_160000_testimonial_consent_check.up,
    down: migration_20260920_160000_testimonial_consent_check.down,
    name: '20260920_160000_testimonial_consent_check',
  },
  {
    up: migration_20260921_071137_jobs_stats_global.up,
    down: migration_20260921_071137_jobs_stats_global.down,
    name: '20260921_071137_jobs_stats_global'
  },
];
