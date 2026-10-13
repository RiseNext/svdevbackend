import * as migration_20260920_153759_initial_schema from './20260920_153759_initial_schema';
import * as migration_20260920_160000_testimonial_consent_check from './20260920_160000_testimonial_consent_check';
import * as migration_20260921_071137_jobs_stats_global from './20260921_071137_jobs_stats_global';
import * as migration_20260921_120000_drop_lead_notified_at from './20260921_120000_drop_lead_notified_at';
import * as migration_20260922_020330_add_project_brochure from './20260922_020330_add_project_brochure';
import * as migration_20260922_073843_add_videos from './20260922_073843_add_videos';
import * as migration_20260922_103833_hero_videos from './20260922_103833_hero_videos';
import * as migration_20260930_044232_add_project_logo from './20260930_044232_add_project_logo';
import * as migration_20261012_053106_add_blog_posts_and_promo_video from './20261012_053106_add_blog_posts_and_promo_video';
import * as migration_20261012_054303_add_hero_media from './20261012_054303_add_hero_media';
import * as migration_20261012_064113_add_project_videos from './20261012_064113_add_project_videos';
import * as migration_20261013_090000_partial_unique_active_only from './20261013_090000_partial_unique_active_only';

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
    name: '20260922_103833_hero_videos',
  },
  {
    up: migration_20260930_044232_add_project_logo.up,
    down: migration_20260930_044232_add_project_logo.down,
    name: '20260930_044232_add_project_logo',
  },
  {
    up: migration_20261012_053106_add_blog_posts_and_promo_video.up,
    down: migration_20261012_053106_add_blog_posts_and_promo_video.down,
    name: '20261012_053106_add_blog_posts_and_promo_video',
  },
  {
    up: migration_20261012_054303_add_hero_media.up,
    down: migration_20261012_054303_add_hero_media.down,
    name: '20261012_054303_add_hero_media',
  },
  {
    up: migration_20261012_064113_add_project_videos.up,
    down: migration_20261012_064113_add_project_videos.down,
    name: '20261012_064113_add_project_videos'
  },
  {
    up: migration_20261013_090000_partial_unique_active_only.up,
    down: migration_20261013_090000_partial_unique_active_only.down,
    name: '20261013_090000_partial_unique_active_only',
  },
];
