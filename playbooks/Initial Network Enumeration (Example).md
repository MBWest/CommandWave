# Initial Network Enumeration Playbook 

This playbook outlines basic steps for initial network enumeration, including OS detection, when you are only provided with a target IP address. The `$TargetIP` variable should be set in the CommandWave UI.

**Output Files:** Nmap scans will save results in three formats (Nmap, Grepable, XML) using the `-oA` flag. Remember to adjust filenames if running multiple scans against the same target.

## Step 1: Host Discovery (Ping Scan)

First, determine if the target host is online and responding to ICMP echo requests (pings).

```bash
# Send 4 ping packets to the target IP
ping -c 4 $TargetIP
```

* **Success:** If you receive replies, the host is likely online. Proceed to port scanning.
* **Failure:** If there's no reply, the host might be offline, configured to block pings, or there might be network issues. You might still attempt port scanning, but be aware the host could be unreachable.

## Step 2: Port Scanning & Service Version Detection (Nmap)

Use Nmap to identify open TCP ports and the services running on them. This scan covers the most common 1000 ports and attempts version detection. Results are saved to files prefixed `nmap_tcp_scan`.

```bash
# Scan top 1000 TCP ports, detect versions, save output
nmap -sV -oA nmap_tcp_scan_$TargetIP $TargetIP
```

* **Review Output:** Check the terminal output and the generated files (`nmap_tcp_scan_$TargetIP.nmap`, `.gnmap`, `.xml`) for open ports and services.

* **Alternative (Faster Scan):** If the initial scan is too slow, you can try scanning only the most common ports first, saving the results:
```bash
# Scan the default (usually top 1000) ports without version detection, save output
# nmap -oA nmap_basic_scan_$TargetIP $TargetIP

# Or scan only the top 100 ports quickly, save output
# nmap -F -oA nmap_fast_scan_$TargetIP $TargetIP
```

## Step 3: Operating System (OS) Detection (Nmap)

Attempt to determine the operating system of the target host. This often requires at least one open and one closed TCP port found in the previous step and usually requires root/sudo privileges. Results are saved to files prefixed `nmap_os_scan`.

```bash
# Attempt OS detection (requires root/sudo), save output
sudo nmap -O -oA nmap_os_scan_$TargetIP $TargetIP
```

* **Note:** OS detection is not always accurate and can sometimes be unreliable, especially if firewalls interfere. Check the Nmap output for confidence levels.

* **Alternative (Aggressive OS Scan):** Combine OS detection with service/version scanning if needed (requires root/sudo):
```bash
# Combine service version detection and OS detection, save output
# sudo nmap -sV -O -oA nmap_combined_scan_$TargetIP $TargetIP
```

* **Alternative (UDP Scan):** If necessary, you can also scan for open UDP ports, saving the results. UDP scanning is typically slower.
```bash
# Scan common UDP ports (requires root/sudo), save output
# sudo nmap -sU --top-ports 100 -oA nmap_udp_scan_$TargetIP $TargetIP
```

## Step 4: Analyze Results and Next Steps

Review the output from all Nmap scans (terminal and saved files):
* Identify open ports (TCP and potentially UDP).
* Note the services and versions detected.
* Check the identified OS (if detection was successful).
* Based on the open ports, services, and potential OS, decide on further enumeration steps (e.g., web enumeration, SMB enumeration, vulnerability scanning, exploit research).

This playbook provides the initial foothold for network discovery. Subsequent actions depend heavily on the results of these initial scans.
