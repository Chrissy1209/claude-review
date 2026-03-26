// demo-review.ts
// This file contains intentional bugs and code smells for AI code review demo

import * as fs from 'fs';

// 1. Hardcoded credentials (security issue)
const API_KEY = "sk-1234567890abcdef";
const DB_PASSWORD = "admin123";

// 2. Any type abuse
function processData(data: any): any {
  return data.value * 2;
}

// 3. No error handling on async operations
async function fetchUser(id: number) {
  const response = await fetch(`http://api.example.com/users/${id}`); // HTTP not HTTPS
  const data = await response.json();
  return data;
}

// 4. SQL injection vulnerability
function getUserQuery(username: string): string {
  return `SELECT * FROM users WHERE username = '${username}'`;
}

// 5. Memory leak - event listener never removed
function setupListener() {
  const handler = () => {
    console.log("clicked");
  };
  document.addEventListener("click", handler);
  // handler is never removed
}

// 6. == instead of ===
function checkStatus(status: any) {
  if (status == 0) {
    return "inactive";
  }
  if (status == "1") {
    return "active";
  }
}

// 7. Mutating function arguments
function addItem(list: string[], item: string) {
  list.push(item); // mutates the original array
  return list;
}

// 8. Ignoring promise rejection / floating promise
function saveData(payload: object) {
  fetch("/api/save", {
    method: "POST",
    body: JSON.stringify(payload),
  }); // no await, no .catch()
}

// 9. Deeply nested callbacks (callback hell)
function loadConfig(callback: Function) {
  fs.readFile("config.json", (err, data) => {
    if (!err) {
      fs.readFile("secrets.json", (err2, secrets) => {
        if (!err2) {
          fs.readFile("overrides.json", (err3, overrides) => {
            if (!err3) {
              callback(data, secrets, overrides);
            }
          });
        }
      });
    }
  });
}

// 10. Unused variables and dead code
function calculate(a: number, b: number) {
  const unused = "this is never used";
  const result = a + b;
  return result;

  // dead code below
  console.log("done");
}

// 11. No input validation
function divide(a: number, b: number): number {
  return a / b; // no check for b === 0
}

// 12. Catching and swallowing errors silently
async function readConfig() {
  try {
    const raw = fs.readFileSync("config.json", "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    // silently ignored
  }
}

// 13. Object mutation via reference
const DEFAULT_OPTIONS = {
  timeout: 3000,
  retries: 3,
};

function getOptions(overrides: object) {
  return Object.assign(DEFAULT_OPTIONS, overrides); // mutates DEFAULT_OPTIONS
}

// 14. console.log left in production code
function authenticate(token: string): boolean {
  console.log("token:", token); // leaks sensitive info
  return token.length > 10;
}
