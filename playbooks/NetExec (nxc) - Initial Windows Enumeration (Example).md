# NetExec (nxc) - Initial Windows Enumeration Playbook

This playbook uses NetExec (`nxc`) for initial enumeration tasks against Microsoft Windows targets. Set the required variables like `$TargetIP` in the CommandWave UI. Some commands might benefit from `$UserFile` and `$PassFile` if you have potential credentials.

**Note:** NetExec was formerly CrackMapExec (`cme`). The commands are similar, but ensure you are using the correct binary (`nxc`).

## Step 1: Basic SMB Connectivity & Null Session Check

First, check if the target responds on SMB ports (139/445) and if null sessions are enabled. Null sessions allow unauthenticated enumeration.

```bash
# Basic SMB check against the target IP
nxc smb $TargetIP

# Explicitly check for null session possibility
nxc smb $TargetIP -u '' -p ''
```

* If you see `(+)` symbols, it indicates success (e.g., connection established).
* Successful null session login (`-u '' -p ''`) is a significant finding.

## Step 2: Enumerate SMB Shares

If SMB is accessible (especially with a null session), enumerate available shares.

```bash
# Enumerate shares using null session
nxc smb $TargetIP -u '' -p '' --shares

# If null session fails, but you have credentials:
# nxc smb $TargetIP -u <user> -p <password> --shares
# nxc smb $TargetIP -u ./users.txt -p ./pass.txt --shares # Requires $UserFile/$PassFile set
```

* Look for shares with permissive access (READ/WRITE for Everyone or Authenticated Users), especially `SYSVOL` and `NETLOGON` on Domain Controllers.

## Step 3: Enumerate Users

Attempt to enumerate domain or local users. SAMR enumeration often requires authentication (even null session sometimes works), while LSA might require higher privileges.

```bash
# Enumerate users via SAMR (requires auth - null session might work)
nxc smb $TargetIP -u '' -p '' --users

# Enumerate users via SAMR with known credentials
# nxc smb $TargetIP -u <user> -p <password> --users

# Attempt LSA secrets dump (requires high privileges on target)
# nxc smb $TargetIP -u <admin_user> -p <admin_pass> -M lsassy
```

## Step 4: Enumerate Password Policy

Check the domain or local password policy. This helps understand password complexity requirements and lockout thresholds.

```bash
# Get password policy (requires auth - null session might work)
nxc smb $TargetIP -u '' -p '' --pass-pol

# Get password policy with known credentials
# nxc smb $TargetIP -u <user> -p <password> --pass-pol
```

## Step 5: Identify Domain Controllers & Domain Info

If the target is domain-joined, try to identify domain controllers and gather domain information.

```bash
# Get domain info (often works with null session)
nxc smb $TargetIP -u '' -p '' --domain

# Get domain controllers (requires auth)
# nxc smb $TargetIP -u <user> -p <password> --dc-list
```

## Step 6: Check SMB Signing

Determine if SMB signing is required or enabled. If disabled (or not required), the host might be vulnerable to SMB relay attacks.

```bash
# Check SMB signing status
nxc smb $TargetIP --gen-relay-list targets.txt

# (Review the targets.txt file - nxc might output signing info directly too)
# Alternatively, check connection output from Step 1. Look for "signing:False".
```

## Step 7: Further Enumeration Modules

NetExec has many modules. Explore others based on findings.

```bash
# List available SMB modules
nxc smb --list-modules

# Example: Enumerate logged-on users (requires privileges)
# nxc smb $TargetIP -u <user> -p <password> -M loggedon_users

# Example: Enumerate sessions (requires privileges)
# nxc smb $TargetIP -u <user> -p <password> -M sessions
```

**Analysis:** Consolidate information gathered from shares, users, policies, and domain details to understand the target environment and plan further actions like targeted credential attacks, vulnerability scanning, or exploitation.
