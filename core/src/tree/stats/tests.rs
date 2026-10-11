use super::*;
use crate::categories::Category;
use crate::tree::{flags, sample_tree};

fn id_of(tree: &Tree, name: &str) -> u32 {
    (0..tree.len() as u32)
        .find(|&id| tree.name(id) == name)
        .unwrap()
}

#[test]
fn type_stats_sum_files_by_category() {
    let tree = sample_tree();
    let all = tree.type_stats(0);
    assert_eq!(
        all[Category::Video as usize],
        TypeStat {
            files: 1,
            size: 500
        }
    );
    assert_eq!(
        all[Category::Documents as usize],
        TypeStat { files: 2, size: 32 }
    );
    assert_eq!(
        all[Category::Images as usize],
        TypeStat { files: 1, size: 40 }
    );
    assert_eq!(all.iter().map(|s| s.size).sum::<u64>(), tree.node(0).size);
    let docs = tree.type_stats(id_of(&tree, "docs"));
    assert_eq!(docs[Category::Video as usize], TypeStat::default());
    assert_eq!(docs[Category::Images as usize].files, 1);
    let pdf = tree.type_stats(id_of(&tree, "b.pdf"));
    assert_eq!(
        pdf[Category::Documents as usize],
        TypeStat { files: 1, size: 30 }
    );
}

#[test]
fn dead_files_are_skipped() {
    let mut tree = sample_tree();
    let mp4 = id_of(&tree, "a.mp4");
    tree.nodes_mut_for_test()[mp4 as usize].flags &= !flags::ALIVE;
    assert_eq!(
        tree.type_stats(0)[Category::Video as usize],
        TypeStat::default()
    );
}
