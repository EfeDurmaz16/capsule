# Machine Model

Machines include EC2, GCP Compute Engine, Azure VM, bare metal, Firecracker directly, Nomad, and lower-level Fly Machines.

Machines are leakier than sandboxes, jobs, services, or edge deployments. Image formats, disks, networking, firewall rules, identity, SSH, startup scripts, regions, placement, snapshots, and cleanup differ substantially.

Use the machine primitive when the user needs lower-level control. Do not hide provider-specific security, networking, volume, or lifecycle details behind false portability.
