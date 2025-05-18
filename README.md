# task-scheduler

A flexible task scheduler for Node.js applications that supports cron patterns, cooldown periods, and different execution modes. It's designed to work seamlessly in both development and production environments, with special consideration for containerized deployments.

## Features

- 6-segment cron patterns with seconds precision
- Built-in cooldown mechanism to prevent task overlap
- Sequential task execution with error isolation
- Development/Production mode switching via environment variables
- Comprehensive TypeScript support
- Detailed execution logging
- Minimal dependencies (only requires 'cron')

## Installation

```bash
npm install @corundex/task-scheduler
```

## Basic Usage

```typescript
import { TaskScheduler } from '@corundex/task-scheduler';

const scheduler = new TaskScheduler('*/5 * * * * * @ 30');

scheduler.register(async () => {
  await doSomething();
});

await scheduler.run();
```

## Constructor Parameters

```typescript
constructor(
  scheduleString?: string,
  options?: TaskSchedulerOptions
)
```

### Schedule String Parameter

The `scheduleString` parameter defines when tasks should run and can include an optional cooldown period.

Format: `"* * * * * * @ cooldownSeconds"`

```
* * * * * *
│ │ │ │ │ │
│ │ │ │ │ └ day of week (0-7, 0 or 7 is Sun)
│ │ │ │ └── month (1-12)
│ │ │ └──── day of month (1-31)
│ │ └────── hour (0-23)
│ └──────── minute (0-59)
└────────── second (0-59)
```

Optional cooldown: `@ seconds`

Examples:
```typescript
// Every 5 seconds with 30 seconds cooldown
'*/5 * * * * * @ 30'

// Every minute at second 0
'0 * * * * *'

// Every day at 2:30 AM with 1 hour cooldown
'0 30 2 * * * @ 3600'

// Every Monday at midnight
'0 0 0 * * 1'
```

### Options Parameter

The `options` object allows you to customize the scheduler's behavior:

#### backupCooldownSeconds
Controls the minimum time between task executions when not specified in the schedule string.

```typescript
interface TaskSchedulerOptions {
  backupCooldownSeconds?: number;
}
```

- Purpose: Prevents task overlap and resource exhaustion
- Default: 0 (no cooldown)
- Unit: Seconds
- Priority: Schedule string cooldown takes precedence if both are specified

Example:
```typescript
// Set 60-second cooldown if not specified in schedule
const scheduler = new TaskScheduler('*/5 * * * * *', {
  backupCooldownSeconds: 60
});

// Schedule cooldown (30) overrides backup cooldown (60)
const scheduler = new TaskScheduler('*/5 * * * * * @ 30', {
  backupCooldownSeconds: 60
});
```

#### immediateEnvName
Defines an environment variable that triggers immediate task execution instead of scheduled runs.

```typescript
interface TaskSchedulerOptions {
  immediateEnvName?: string;
}
```

- Purpose: Enables different behavior in development vs production environments
- Default: undefined (always use scheduled execution)
- Behavior: 
  - If the specified environment variable exists: Tasks run immediately once
  - If not set or variable doesn't exist: Tasks run on schedule

Common Use Cases:
1. Local Development:
   ```typescript
   // Tasks run immediately if LOCAL=true is set
   const scheduler = new TaskScheduler('*/5 * * * * *', {
     immediateEnvName: 'LOCAL'
   });
   ```
   Run with: `LOCAL=true node script.js`

2. Debug Mode:
   ```typescript
   const scheduler = new TaskScheduler('*/5 * * * * *', {
     immediateEnvName: 'DEBUG'
   });
   ```
   Run with: `DEBUG=1 node script.js`

3. Testing Environment:
   ```typescript
   const scheduler = new TaskScheduler('*/5 * * * * *', {
     immediateEnvName: 'NODE_ENV',
   });
   ```
   Run with: `NODE_ENV=test node script.js`

#### logger
Custom logger implementation for tracking task execution.

```typescript
interface TaskSchedulerOptions {
  logger?: Console;
}
```

- Purpose: Allows integration with your application's logging system
- Default: console
- Requirements: Must implement Console interface (info, error methods)
- Usage: Logs task execution, errors, and timing information

Example:
```typescript
import winston from 'winston';

const customLogger = {
  info: (msg: string) => winston.info(msg),
  error: (msg: string) => winston.error(msg)
};

const scheduler = new TaskScheduler('*/5 * * * * *', {
  logger: customLogger
});
```

## Environment-Specific Configuration

### Development Environment

```typescript
// Development configuration
const scheduler = new TaskScheduler('*/5 * * * * *', {
  immediateEnvName: 'LOCAL',    // Run immediately if LOCAL is set
  backupCooldownSeconds: 5,     // Short cooldown for quick iterations
  logger: devLogger            // Detailed logging
});

// Run with: LOCAL=true node script.js
```

### Production Environment

```typescript
// Production configuration
const scheduler = new TaskScheduler(process.env.SCHEDULE || '*/5 * * * * *', {
  backupCooldownSeconds: 60,    // Longer cooldown for stability
  logger: productionLogger     // Production-grade logging
});
```

### Docker Environment

```yaml
# docker-compose.yml
services:
  app:
    environment:
      - SCHEDULE=*/5 * * * * * @ 30
```

```typescript
// Application code
const scheduler = new TaskScheduler(process.env.SCHEDULE, {
  backupCooldownSeconds: 60
});
```

## Task Registration and Execution

Tasks are executed sequentially in the order they're registered:

```typescript
const scheduler = new TaskScheduler('*/5 * * * * *', {
  backupCooldownSeconds: 30
});

// First task to run
scheduler.register(async () => {
  await task1();
});

// Runs after task1 completes
scheduler.register(async () => {
  await task2();
});

// Runs even if previous tasks fail
scheduler.register(async () => {
  await task3();
});

await scheduler.run();
```

## Error Handling

The scheduler provides error isolation between tasks:

```typescript
scheduler.register(async () => {
  throw new Error('Task 1 failed');
  // Next task still runs
});

scheduler.register(async () => {
  // This task executes despite previous error
  await task2();
});
```

## Stopping the Scheduler

```typescript
const scheduler = new TaskScheduler('*/5 * * * * *');
await scheduler.run();

// Later when needed:
scheduler.stop();
```

## Best Practices

1. **Cooldown Selection**
   - Set appropriate cooldowns to prevent resource exhaustion
   - Use shorter cooldowns for quick tasks
   - Use longer cooldowns for resource-intensive operations

2. **Environment Configuration**
   - Use immediateEnvName for development/testing
   - Set reasonable defaults for production
   - Use environment variables for Docker deployments

3. **Error Handling**
   - Implement try/catch in tasks for specific error handling
   - Use custom logger for error tracking
   - Set appropriate timeouts for async operations

4. **Resource Management**
   - Clean up resources in tasks
   - Implement proper error recovery
   - Monitor task execution times

## TypeScript Support

The package includes TypeScript definitions:

```typescript
interface TaskSchedulerOptions {
  backupCooldownSeconds?: number;
  immediateEnvName?: string;
  logger?: Console;
}

type TaskFn = (() => Promise<void>) | (() => void);
```

## License

MIT
