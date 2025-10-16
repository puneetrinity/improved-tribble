import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
export let errorRate = new Rate('errors');

export let options = {
  stages: [
    { duration: '30s', target: 10 }, // Ramp up to 10 users
    { duration: '1m', target: 10 },  // Stay at 10 users
    { duration: '30s', target: 25 }, // Ramp up to 25 users
    { duration: '1m', target: 25 },  // Stay at 25 users
    { duration: '30s', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests must complete below 3s
    http_req_failed: ['rate<0.2'],     // Error rate must be below 20%
    errors: ['rate<0.2'],              // Custom error rate below 20%
  },
};

const BASE_URL = 'http://localhost:5000';

export default function () {
  // Test 1: Homepage load
  let response = http.get(`${BASE_URL}/`, { timeout: '10s' });
  let success1 = check(response, {
    'homepage status is valid': (r) => r.status >= 200 && r.status < 500,
    'homepage loads in reasonable time': (r) => r.timings.duration < 2000,
  });
  if (!success1) errorRate.add(1);

  sleep(Math.random() * 2 + 1); // Random sleep 1-3 seconds

  // Test 2: Jobs API endpoint
  response = http.get(`${BASE_URL}/api/jobs`, { timeout: '10s' });
  let success2 = check(response, {
    'jobs API status is acceptable': (r) => r.status === 200 || r.status === 401 || r.status === 403,
    'jobs API responds timely': (r) => r.timings.duration < 3000,
    'jobs API returns valid response': (r) => {
      if (r.status === 401 || r.status === 403) return true;
      try {
        JSON.parse(r.body);
        return true;
      } catch (e) {
        return r.status !== 200; // Only fail if 200 but invalid JSON
      }
    },
  });
  if (!success2) errorRate.add(1);

  sleep(Math.random() * 2 + 1);

  // Test 3: Job search simulation (only run 50% of the time to reduce load)
  if (Math.random() > 0.5) {
    const searchParams = ['developer', 'manager', 'designer', 'analyst'];
    const randomSearch = searchParams[Math.floor(Math.random() * searchParams.length)];
    
    response = http.get(`${BASE_URL}/api/jobs?search=${randomSearch}`, { timeout: '10s' });
    let success3 = check(response, {
      'search API responds correctly': (r) => r.status === 200 || r.status === 401 || r.status === 403,
      'search completes reasonably': (r) => r.timings.duration < 3000,
    });
    if (!success3) errorRate.add(1);
  }

  sleep(Math.random() * 3 + 1);

  // Test 4: Login simulation (only run 30% of the time)
  if (Math.random() > 0.7) {
    const credentials = {
      username: 'testuser',
      password: 'testpass'
    };

    response = http.post(`${BASE_URL}/api/login`, JSON.stringify(credentials), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s'
    });
    
    let success4 = check(response, {
      'login API responds': (r) => r.status >= 200 && r.status < 500,
      'login responds reasonably': (r) => r.timings.duration < 5000,
    });
    if (!success4) errorRate.add(1);
  }

  sleep(Math.random() * 2 + 1);

  // Test 5: Skip AI Analysis during stress test to prevent overwhelming the server
  // This endpoint is computationally expensive and should be tested separately
}

export function teardown(data) {
  console.log('Performance test completed');
  console.log(`Average response time: ${data.http_req_duration}`);
  console.log(`Error rate: ${data.http_req_failed}`);
}