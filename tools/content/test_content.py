import unittest
from build_packs import make_maze

class MazeTests(unittest.TestCase):
    def test_all_twenty_printed_mazes_are_trees_and_have_valid_solutions(self):
        for number in range(20):
            cols=10+(number//5)*2;rows=cols+2
            edges,path=make_maze(cols,rows,20261106+number)
            self.assertEqual(len(edges),cols*rows-1)
            self.assertEqual(path[0],(0,0));self.assertEqual(path[-1],(cols-1,rows-1))
            self.assertEqual(len(set(path)),len(path))
            self.assertTrue(all(tuple(sorted((a,b))) in edges for a,b in zip(path,path[1:])))
    def test_reproducible(self):
        self.assertEqual(make_maze(10,12,4),make_maze(10,12,4))
        self.assertNotEqual(make_maze(10,12,4),make_maze(10,12,5))

if __name__=='__main__':unittest.main()
