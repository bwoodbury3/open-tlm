/**
 * A queue that allows a fixed number of requests to execute at once.
 */
export class TaskQueue {
    /**
     * Constructor.
     *
     * @param {*} max_concurrent_tasks The maximum number of tasks that can be
     *      issued in parallel.
     * @param {*} capacity The total queue capacity beyond which, older tasks
     *      that are waiting will be ejected to make space for newer, fresher tasks.
     */
    constructor(max_concurrent_tasks, capacity) {
        this.max_concurrent_tasks = max_concurrent_tasks;
        this.capacity = capacity;
        this.queue = [];
        this.in_progress = 0;
    }

    /**
     * Enqueue a task. The task must be async and return a promise.
     *
     * @param {*} func The task to run (an async).
     */
    enqueue(func) {
        if (!is_async(func)) {
            throw new Error("TaskQueue only accepts asynchronous functions");
        }

        /*
         * Evict old tasks if we're at capacity.
         */
        if (this.queue.length >= this.capacity) {
            this.queue.shift();
        }

        this.queue.push(func);
        this._maybe_run_task();
    }

    /**
     * Run the next task if we can.
     */
    async _maybe_run_task() {
        /*
         * Too many tasks in progress, or no tasks in the queue.
         */
        if (this.in_progress >= this.max_concurrent_tasks || this.queue.length === 0) {
            return;
        }

        /*
         * Run the next task.
         */
        this.in_progress += 1;
        const func = this.queue.shift();
        try {
            await func();
        } catch (error) {
            console.log("Task execution unsuccessful!", error);
        }

        /*
         * Kick off another task if one is waiting.
         */
        this.in_progress -= 1;
        this._maybe_run_task();
    }
}

/**
 * Return true if the function is asynchronous.
 *
 * @param {*} func The function.
 *
 * @returns true/false.
 */
function is_async(func) {
    return func.constructor.name === "AsyncFunction";
}