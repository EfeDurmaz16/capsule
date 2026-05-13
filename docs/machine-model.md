# Machine Model

Machines include EC2, GCP Compute Engine, Azure VM, bare metal, Firecracker directly, Nomad, and lower-level Fly Machines.

Machines are leakier than sandboxes, jobs, services, or edge deployments. Image formats, disks, networking, firewall rules, identity, SSH, startup scripts, regions, placement, snapshots, and cleanup differ substantially.

Use the machine primitive when the user needs lower-level control. Do not hide provider-specific security, networking, volume, or lifecycle details behind false portability.

The core machine facade models create, status, start, stop, and destroy as separate capabilities. Adapters must mark each lifecycle action honestly because VM lifecycle APIs differ in state transitions, billing semantics, termination protection, data persistence, and network identity.

The real EC2 adapter implements machine creation through `RunInstances` and lifecycle operations through `DescribeInstances`, `StartInstances`, `StopInstances`, and `TerminateInstances`. It can create one instance from an AMI and instance type with optional subnet, security groups, key, IAM profile, tags, and user data. Capsule does not hide SSH, patching, IAM, network exposure, disk lifecycle, startup script security, or teardown.

The real Fly adapter maps Fly Machines to machine lifecycle operations through the Fly Machines API. `job.run` creates an auto-destroy Machine with restart policy `no`; log streaming, exit-code waiting, volumes, services, and Fly App networking are intentionally separate future capabilities.
