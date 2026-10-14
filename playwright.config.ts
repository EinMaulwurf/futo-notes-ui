import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',timeout:45000,workers:1,use:{baseURL:process.env.TEST_WEB_URL||'http://127.0.0.1:13006',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure'},reporter:'list'});
