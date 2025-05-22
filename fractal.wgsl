const MAX_WORMHOLES = 10u;

// Structs for Parameters
struct Quaternion {
    x: f32,
    y: f32,
    z: f32,
    w: f32,
}

struct FractalParams {
    julia_c: Quaternion,
    max_iterations: u32,
    escape_threshold: f32,
    power: f32, // Currently implicitly 2.0 in quaternion_julia_de
}

// Binding Groups for Parameters
@group(0) @binding(0) var<uniform> params: FractalParams;

// Quaternion Math Functions
fn q_add(a: Quaternion, b: Quaternion) -> Quaternion {
    return Quaternion(
        a.x + b.x,
        a.y + b.y,
        a.z + b.z,
        a.w + b.w
    );
}

fn q_mul(a: Quaternion, b: Quaternion) -> Quaternion {
    return Quaternion(
        a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,  // x
        a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,  // y
        a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,  // z
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z   // w
    );
}

fn q_length_sq(q: Quaternion) -> f32 {
    return q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w;
}

fn q_length(q: Quaternion) -> f32 {
    return sqrt(q_length_sq(q));
}

// q_power_n is not explicitly defined as a general function here,
// as quaternion_julia_de implicitly uses power = 2 via q_mul(z,z).
// A general q_power_n(q: Quaternion, n: f32) -> Quaternion is complex (q_exp(n * q_log(q))).

// Distance Estimator Function
// Now takes current_julia_c as a parameter
fn quaternion_julia_de(p_input: Quaternion, current_julia_c: Quaternion) -> f32 {
    var z = p_input;
    // Initialize derivative dz/dp. For z_0 = p, dz_0/dp = I (identity).
    // For a scalar p, this would be 1. For a quaternion p, it's more like a basis vector.
    // Let's assume for simplicity in DE context, we start with a unit magnitude derivative.
    var dz = Quaternion(1.0, 0.0, 0.0, 0.0);

    var m2 = 0.0; // squared magnitude of z

    // params.max_iterations and params.escape_threshold are still from global params
    for (var i = 0u; i < params.max_iterations; i = i + 1u) {
        // Derivative update for z_new = z_old^2 + c
        // If z_n+1 = z_n * z_n + julia_c
        // then dz_n+1 = (z_n * dz_n) + (dz_n * z_n) (using product rule, z is variable, dz is its derivative w.r.t p)
        // This assumes params.power is 2.0 (from global params).
        dz = q_add(q_mul(z, dz), q_mul(dz, z));

        // Iterate z: z = z^2 + c (using current_julia_c)
        z = q_add(q_mul(z, z), current_julia_c);

        m2 = q_length_sq(z);
        if (m2 > params.escape_threshold * params.escape_threshold) {
            break;
        }
    }

    let len_z = sqrt(m2);
    let len_dz = q_length(dz);

    // Distance estimator: 0.5 * |z| * log|z| / |dz|
    // Add epsilon to len_dz to avoid division by zero or instability.
    if (len_dz < 0.000001) { // Check for very small len_dz
        return 0.0; // Inside the set or at a critical point where derivative vanishes
    }
    
    // log(x) is undefined for x <= 0. len_z is sqrt(m2), so it's >= 0.
    // If len_z is 0, log(len_z) is -infinity.
    // If len_z is very small (e.g. < 1), log(len_z) is negative.
    // The DE formula often assumes |z| > 1 at escape.
    // If len_z is small, this point is likely in the set, so DE should be small or zero.
    if (len_z < 0.000001) { // Check for very small len_z (effectively zero)
        return 0.0;
    }
    
    return 0.5 * len_z * log(len_z) / len_dz;
}

// --- Ship Physics Simulation ---

// Function to calculate the gradient of the distance estimator field
// Uses central differences.
// params: FractalParams is used by quaternion_julia_de implicitly for max_iterations etc.
// Now takes current_julia_c_for_gradient to pass to quaternion_julia_de.
fn get_gradient_at_point(p: Quaternion, epsilon: f32, current_julia_c_for_gradient: Quaternion) -> vec4<f32> {
    let de_center = quaternion_julia_de(p, current_julia_c_for_gradient);

    let de_px = quaternion_julia_de(Quaternion(p.x + epsilon, p.y, p.z, p.w), current_julia_c_for_gradient);
    let de_nx = quaternion_julia_de(Quaternion(p.x - epsilon, p.y, p.z, p.w), current_julia_c_for_gradient);
    let grad_x = (de_px - de_nx) / (2.0 * epsilon);

    let de_py = quaternion_julia_de(Quaternion(p.x, p.y + epsilon, p.z, p.w), current_julia_c_for_gradient);
    let de_ny = quaternion_julia_de(Quaternion(p.x, p.y - epsilon, p.z, p.w), current_julia_c_for_gradient);
    let grad_y = (de_py - de_ny) / (2.0 * epsilon);

    let de_pz = quaternion_julia_de(Quaternion(p.x, p.y, p.z + epsilon, p.w), current_julia_c_for_gradient);
    let de_nz = quaternion_julia_de(Quaternion(p.x, p.y, p.z - epsilon, p.w), current_julia_c_for_gradient);
    let grad_z = (de_pz - de_nz) / (2.0 * epsilon);

    let de_pw = quaternion_julia_de(Quaternion(p.x, p.y, p.z, p.w + epsilon), current_julia_c_for_gradient);
    let de_nw = quaternion_julia_de(Quaternion(p.x, p.y, p.z, p.w - epsilon), current_julia_c_for_gradient);
    let grad_w = (de_pw - de_nw) / (2.0 * epsilon);

    return vec4<f32>(grad_x, grad_y, grad_z, grad_w);
}

struct Wormhole {
    is_active: u32, // Pad to 4 bytes
    // 12 bytes padding needed here for entry_pos_4d to align to 16
    entry_pos_4d: vec4<f32>,
    exit_pos_4d: vec4<f32>,
    radius: f32, // Pad to 4 bytes
    // 12 bytes padding needed here for transform_matrix_col0 to align to 16
    transform_matrix_col0: vec4<f32>,
    transform_matrix_col1: vec4<f32>,
    transform_matrix_col2: vec4<f32>,
    transform_matrix_col3: vec4<f32>,
    target_julia_c: vec4<f32>, // Quaternion stored as vec4
} // Total size should be 4 + 12 + 16 + 16 + 4 + 12 + 16*4 + 16 = 144 bytes.

struct Ship {
    position: vec4<f32>,     // Current 4D position
    velocity: vec4<f32>,     // Current 4D velocity
    acceleration: vec4<f32>, // Current 4D acceleration (mainly for debug or complex forces)
}

struct ShipPhysicsParams {
    delta_time: f32,         // Time step for simulation
    thrust_force: f32,       // Magnitude of thrust applied along negative gradient
    max_speed: f32,          // Maximum speed limit for the ship
    damping_factor: f32,     // Damping factor to slow down ship over time
    epsilon_gradient: f32,   // Epsilon used for gradient calculation
    // Add other params like mass if needed later
}

// Bindings for the ship physics compute shader
// params: FractalParams is already at @group(0) @binding(0)
// ray_params: RayMarchParams is at @group(0) @binding(1) - for the render pipeline

// For the compute shader, we define its own set of bindings.
// It seems the problem implies a single bind group for the compute shader.
// If FractalParams is needed, it must be bound for this pipeline.
// If RayMarchParams is NOT needed, it shouldn't be here.
// The task specifies:
// @group(0) @binding(0) var<uniform> params: FractalParams;
// @group(0) @binding(1) var<uniform> ship_params: ShipPhysicsParams;
// @group(0) @binding(2) var<storage, read_write> ships: array<Ship>;

// This means the compute shader will have its own pipeline and bind group.
// The render pipeline uses group(0) bindings 0 and 1 for FractalParams and RayMarchParams.
// The compute pipeline will use group(0) bindings 0, 1, and 2 for FractalParams, ShipPhysicsParams, and Ships.
// This is valid as long as the correct bind group is set for each pipeline.

@group(0) @binding(1) var<uniform> ship_physics_params_compute: ShipPhysicsParams; // Renamed to avoid conflict if sharing scope, though WGSL is per-shader stage
@group(0) @binding(2) var<storage, read_write> ships_storage: array<Ship>;


@compute @workgroup_size(64) // Workgroup size, e.g., 64 threads
fn ship_physics_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let ship_index = global_id.x;
    
    // Boundary check
    if (ship_index >= arrayLength(&ships_storage)) {
        return;
    }

    var current_ship = ships_storage[ship_index];
    
    // Calculate gradient at the ship's current position
    // Ships use the main fractal's julia_c (params.julia_c) for their physics.
    let ship_pos_quat = Quaternion(
        current_ship.position.x,
        current_ship.position.y,
        current_ship.position.z,
        current_ship.position.w
    );
    let gradient_vec = get_gradient_at_point(ship_pos_quat, ship_physics_params_compute.epsilon_gradient, params.julia_c);

    // Determine force direction (thrust is applied against the gradient)
    var force_dir = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    let grad_len_sq = dot(gradient_vec, gradient_vec);
    if (grad_len_sq > (0.001 * 0.001)) { // Compare squared lengths to avoid sqrt
        force_dir = -normalize(gradient_vec); // Points "uphill" along the DE field gradient
    }

    // Calculate acceleration (F = ma, assuming mass = 1 for simplicity)
    current_ship.acceleration = force_dir * ship_physics_params_compute.thrust_force;

    // Update velocity (Euler integration)
    current_ship.velocity += current_ship.acceleration * ship_physics_params_compute.delta_time;

    // Apply damping
    // (1.0 - damping_factor) is a common way, or (1.0 - damping_factor * delta_time) for frame-rate independence
    current_ship.velocity *= (1.0 - ship_physics_params_compute.damping_factor * ship_physics_params_compute.delta_time);

    // Enforce speed limit
    let speed_sq = dot(current_ship.velocity, current_ship.velocity);
    let max_speed_sq = ship_physics_params_compute.max_speed * ship_physics_params_compute.max_speed;
    if (speed_sq > max_speed_sq && speed_sq > 0.000001) { // speed_sq > epsilon to avoid normalize(0)
        current_ship.velocity = normalize(current_ship.velocity) * ship_physics_params_compute.max_speed;
    }

    // Update position (Euler integration)
    current_ship.position += current_ship.velocity * ship_physics_params_compute.delta_time;

    // Store updated ship data
    ships_storage[ship_index] = current_ship;
}


// --- Ray Marching Shader ---

struct RayMarchParams {
    camera_pos_4d: vec4<f32>,
    ray_transform_col0: vec4<f32>, // Transforms screen_uv.x
    ray_transform_col1: vec4<f32>, // Transforms screen_uv.y
    ray_transform_col2: vec4<f32>, // Base direction (e.g., forward vector)
    canvas_size: vec2<f32>,
    max_ray_steps: u32,
    min_hit_distance: f32,
    max_march_distance: f32,
}

@group(0) @binding(1) var<uniform> ray_params: RayMarchParams;
@group(0) @binding(3) var<uniform> wormholes: array<Wormhole, MAX_WORMHOLES>;


struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) screen_uv: vec2<f32>, // Normalized UVs (0-1)
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index : u32) -> VertexOutput {
    var out: VertexOutput;
    
    // Full screen triangle UVs and positions
    // screen_uv = (clip_position.xy * 0.5 + 0.5) with clip_position ranging from -1 to 1
    // vertex_index | x_idx | y_idx | clip_x | clip_y | uv_x | uv_y
    // -----------|-------|-------|--------|--------|------|------
    // 0          | 0     | 0     | -1.0   | -1.0   | 0.0  | 0.0
    // 1          | 1     | 0     |  3.0   | -1.0   | 2.0  | 0.0 -> needs adjustment for 0-1
    // 2          | 0     | 1     | -1.0   |  3.0   | 0.0  | 2.0 -> needs adjustment for 0-1

    // Using the common array method for full-screen triangle
    // Produces clip positions: (-1,-1), (3,-1), (-1,3)
    // And screen_uvs: (0,0), (2,0), (0,2) - this needs to be remapped to 0-1 for fragment shader.
    // Better: directly compute 0-1 UVs.
    // if clip_position = vec4(pos[idx].x, pos[idx].y, 0.0, 1.0)
    // then screen_uv = (pos[idx] * vec2(0.5, -0.5) + vec2(0.5, 0.5)) for typical Y-down UVs
    // Or, screen_uv = (pos[idx] + 1.0) * 0.5 for Y-up UVs ranging 0-1

    let positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0), // bottom-left
        vec2<f32>( 3.0, -1.0), // way off to the right
        vec2<f32>(-1.0,  3.0)  // way up
    );

    out.clip_position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    // Remap clip positions to UVs: (-1,-1) -> (0,0), (1,1) -> (1,1) for default clip space
    // For this triangle, (-1,-1) -> (0,0), (3,-1) -> (2,0), (-1,3) -> (0,2)
    // To get screen_uv in 0-1 range:
    // screen_uv.x = (clip_position.x / 2.0) + 0.5, but clip_position.x is not vertex_index based.
    // It's simpler:
    // For vertex 0: (0,0)
    // For vertex 1: (2,0) -> means it covers 2 screens width. If we use (1,0) for this, it's half.
    // For vertex 2: (0,2)
    // This mapping makes the UVs span from 0 to 2.
    // The actual area rendered is the intersection of the clip space (-1 to 1 for x,y) and the triangle.
    // The standard UV mapping for this triangle to cover [0,1]x[0,1] is:
    // vert 0 (clip -1,-1) -> uv (0,0)
    // vert 1 (clip  3,-1) -> uv (2,0)
    // vert 2 (clip -1, 3) -> uv (0,2)
    // This is correct for texturing the triangle itself if it were that shape.
    // What we want is that the fragment shader gets UVs that span 0-1 across the *screen*.
    out.screen_uv = (positions[vertex_index].xy * vec2<f32>(0.5, 0.5)) + vec2<f32>(0.5, 0.5);
    // Check:
    // V0: (-1,-1) -> (-0.5, -0.5) + (0.5,0.5) = (0,0) - Correct
    // V1: (3,-1)  -> (1.5, -0.5) + (0.5,0.5) = (2,0) - Correct, UVs for full screen triangle are [0,2]x[0,2]
    // V2: (-1,3)  -> (-0.5, 1.5) + (0.5,0.5) = (0,2) - Correct
    // The fragment shader will receive these UVs interpolated over the screen.
    // So screen_uv.xy will range from 0.0 to 1.0 across the visible screen area.

    return out;
}

// Function to generate a 4D ray direction from 2D screen UVs
fn get_ray_dir_4d(screen_uv_norm_01: vec2<f32>) -> vec4<f32> {
    // Convert screen_uv from [0,1] range to [-1,1] range
    let screen_uv_centered = (screen_uv_norm_01 * 2.0) - 1.0;

    // Construct ray direction using the transformation columns
    // This assumes ray_transform_col0 and ray_transform_col1 are basis vectors for the screen plane in 4D,
    // and ray_transform_col2 is the base view direction (e.g., camera's forward vector).
    let dir = ray_params.ray_transform_col0 * screen_uv_centered.x +
              ray_params.ray_transform_col1 * screen_uv_centered.y +
              ray_params.ray_transform_col2;
    return normalize(dir);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var current_ray_pos_4d = ray_params.camera_pos_4d;
    // Use in.screen_uv which are already 0-1 for the screen.
    var ray_dir_4d = get_ray_dir_4d(in.screen_uv); // Changed to var

    var effective_julia_c = params.julia_c; // Default Julia C

    var total_dist_traveled = 0.0;
    var steps = 0u;
    var hit = false;

    for (steps = 0u; steps < ray_params.max_ray_steps; steps = steps + 1u) {
        // Wormhole traversal check
        for (var i = 0u; i < MAX_WORMHOLES; i = i + 1u) {
            if (wormholes[i].is_active == 1u) {
                let vec_to_entry = current_ray_pos_4d - wormholes[i].entry_pos_4d;
                let dist_sq_to_entry = dot(vec_to_entry, vec_to_entry);
                let radius_sq = wormholes[i].radius * wormholes[i].radius;

                if (dist_sq_to_entry < radius_sq) {
                    // Ray is inside the entry portal sphere
                    let transform_matrix = mat4x4<f32>(
                        wormholes[i].transform_matrix_col0,
                        wormholes[i].transform_matrix_col1,
                        wormholes[i].transform_matrix_col2,
                        wormholes[i].transform_matrix_col3
                    );

                    // Transform ray position and direction
                    // Assuming current_ray_pos_4d and ray_dir_4d are vec4<f32>
                    current_ray_pos_4d = (transform_matrix * current_ray_pos_4d).xyzw; // Position uses w=1 implicitly if M is affine
                    ray_dir_4d = normalize((transform_matrix * ray_dir_4d).xyzw);   // Direction uses w=0 implicitly if M is affine

                    // Update Julia C for the new region
                    effective_julia_c = Quaternion(wormholes[i].target_julia_c);
                    
                    // Step out of the portal on the other side to avoid immediate re-entry or stuck issues
                    current_ray_pos_4d += ray_dir_4d * (wormholes[i].radius * 1.01 + 0.01); // Add small fixed step too
                    total_dist_traveled += (wormholes[i].radius * 1.01 + 0.01); // Account for this jump
                    
                    // TODO: Add logic to prevent infinite portal loops if portals are back-to-back.
                    // Could count portal jumps and limit them.

                    break; // Exit wormhole check loop for this ray step
                }
            }
        }

        let p_quat = Quaternion(
            current_ray_pos_4d.x,
            current_ray_pos_4d.y,
            current_ray_pos_4d.z,
            current_ray_pos_4d.w
        );
        // Use the (potentially modified by wormhole) effective_julia_c
        let dist = quaternion_julia_de(p_quat, effective_julia_c);

        if (dist < ray_params.min_hit_distance) {
            hit = true;
            break;
        }

        current_ray_pos_4d += ray_dir_4d * dist;
        total_dist_traveled += dist;

        if (total_dist_traveled > ray_params.max_march_distance) {
            break;
        }
    }

    if (hit) {
        let intensity = 1.0 - f32(steps) / f32(ray_params.max_ray_steps);
        // Brighter for fewer steps
        return vec4<f32>(intensity, intensity, intensity * 1.2, 1.0); // Slight blueish white for hit
    } else {
        return vec4<f32>(0.0, 0.0, 0.1, 1.0); // Dark blue background for miss
    }
}
