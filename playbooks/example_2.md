# Sample Network Scan Playbook

This playbook demonstrates basic network scanning and service interaction steps. Fill in the variables like `$TargetIP` and `$Port` in the UI before executing code blocks.

## Step 1: Initial Ping Scan

First, let's just check if the target is online. This uses the standard ping command.

```bash
ping -c 4 $TargetIP
```

If the ping is successful, we can proceed to port scanning.

## Step 2: Nmap Port Scan

Use Nmap to scan common ports on the `$TargetIP`. You can adjust the `-p` flag or add `-F` for faster scans.

```bash
nmap -sV -p 1-1000 $TargetIP
```

Review the Nmap output for open ports and identified services.

## Step 3: Connect to a Specific Port (if open)

If a specific port like `$Port` is open, you might try connecting with `netcat` (nc) or Telnet.

```bash
nc -nv $TargetIP $Port
```

*Note: Netcat behaviour varies. This might just check the connection or grab a banner.*

## Step 4: Example Python Interaction (Conceptual)

This is a conceptual Python block. It wouldn't execute directly in a standard shell via the "Execute" button unless your terminal is running a Python interpreter. It demonstrates variable use in a different language context.

```python
import socket

target = "$TargetIP"
port = int("$Port") # Needs error handling in real script!

print(f"Attempting to connect to {target}:{port} using Python...")

try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2) # 2 second timeout
    result = sock.connect_ex((target, port))
    if result == 0:
        print("Connection successful!")
        # sock.sendall(b'GET / HTTP/1.1\r\nHost: example.com\r\n\r\n')
        # data = sock.recv(1024)
        # print(f"Received: {data.decode(errors='ignore')}")
    else:
        print(f"Connection failed (Error code: {result})")
    sock.close()
except Exception as e:
    print(f"An error occurred: {e}")

```

## Step 5: Finishing Up

This concludes the basic scan playbook. Remember to analyze the results from each step. You can add more complex commands or chain different tools based on the findings.
