import * as migration_20260920_153759_initial_schema from './20260920_153759_initial_schema';
import * as migration_20260920_160000_testimonial_consent_check from './20260920_160000_testimonial_consent_check';
import * as migration_20260921_071137_jobs_stats_global from './20260921_071137_jobs_stats_global';
import * as migration_20260921_120000_drop_lead_notified_at from './20260921_120000_drop_lead_notified_at';
import * as migration_20260922_020330_add_project_brochure from './20260922_020330_add_project_brochure';
import * as migration_20260922_073843_add_videos from './20260922_073843_add_videos';
import * as migration_20260922_103833_hero_videos from './20260922_103833_hero_videos';

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
    name: '20260921_071137_jobs_stats_global',
  },
  {
    up: migration_20260921_120000_drop_lead_notified_at.up,
    down: migration_20260921_120000_drop_lead_notified_at.down,
    name: '20260921_120000_drop_lead_notified_at',
  },
  {
    up: migration_20260922_020330_add_project_brochure.up,
    down: migration_20260922_020330_add_project_brochure.down,
    name: '20260922_020330_add_project_brochure',
  },
  {
    up: migration_20260922_073843_add_videos.up,
    down: migration_20260922_073843_add_videos.down,
    name: '20260922_073843_add_videos',
  },
  {
    up: migration_20260922_103833_hero_videos.up,
    down: migration_20260922_103833_hero_videos.down,
    name: '20260922_103833_hero_videos'
  },
];
