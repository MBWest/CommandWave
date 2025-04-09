# Basic Enumeration Playbook

This playbook outlines steps for basic host enumeration, checking common directories and attempting a simple web request. Requires variables like `$TargetIP` and potentially `$Port` (if checking a web server).

## Step 1: Check Current User and System Info

Let's start by identifying the current user and basic system details on the target (assuming shell access).

```bash
whoami
hostname
uname -a
```

These commands provide initial context about the machine you've landed on.

## Step 2: List Home Directory Contents

Check what's inside the current user's home directory. The `-la` flags show hidden files and provide detailed listings.

```bash
ls -la ~/
```

Look for interesting configuration files, scripts, or directories.

## Step 3: Check Common Configuration/Service Directories

Explore some standard directories where configurations or potentially sensitive files might reside.

```bash
# Check web server root (adjust path if needed)
ls -la /var/www/html/

# Check common config directory
ls -la /etc/

# Check user SSH keys (if applicable)
ls -la ~/.ssh/
```

*Note: Access to these directories depends heavily on user privileges.*

## Step 4: Simple Web Request with Curl

If a web server is running on `$TargetIP` (perhaps on `$Port` if not 80/443), try fetching the main page with `curl`. Use `-k` to ignore certificate errors if using HTTPS on a non-standard port or with a self-signed cert.

```bash
# Assuming HTTP on port 80 or HTTPS on 443
curl -v $TargetIP

# Example for specific port (e.g., 8080) - adjust HTTP/HTTPS as needed
# curl -vk https://$TargetIP:$Port
```

Analyze the response headers and content for information about the web server or application.

## Step 5: Check Running Processes

See what processes are running on the system. This can reveal services, applications, or potential privilege escalation vectors.

```bash
ps aux
# Alternatively, for a tree view (if available)
# pstree
```
